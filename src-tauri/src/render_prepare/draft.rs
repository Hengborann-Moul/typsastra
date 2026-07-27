use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};
use typst_syntax::ast::{Arg, AstNode, Expr, FuncCall};
use typst_syntax::SyntaxNode;

pub const DRAFT_LINK_PREFIX: &str = "https://draft-preview.typsastra.invalid/";

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PreviewContentMode {
    #[default]
    Normal,
    Draft,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftImageReference {
    pub source_path: PathBuf,
    pub from_utf16: usize,
    pub to_utf16: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftImageAsset {
    pub id: String,
    pub path: PathBuf,
    pub mime_type: String,
    pub width: u32,
    pub height: u32,
    pub source_bytes: u64,
    pub estimated_decoded_bytes: u64,
    pub references: Vec<DraftImageReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftImageDiagnostic {
    pub source_path: PathBuf,
    pub from_utf16: usize,
    pub to_utf16: usize,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct DraftReplacement {
    pub start: usize,
    pub end: usize,
    pub generated: String,
}

#[derive(Debug, Clone, Default)]
pub struct DraftPreparation {
    pub replacements: Vec<DraftReplacement>,
    pub assets: Vec<DraftImageAsset>,
    pub diagnostics: Vec<DraftImageDiagnostic>,
}

pub fn prepare_draft_images(
    project_root: &Path,
    source_path: &Path,
    destination_path: &Path,
    render_dir: &Path,
    source: &str,
) -> DraftPreparation {
    let root = typst_syntax::parse(source);
    let mut calls = Vec::new();
    collect_image_calls(&root, 0, &mut calls);
    calls.sort_by_key(|call| call.call_start);

    let mut result = DraftPreparation::default();
    for call in calls {
        let reference = DraftImageReference {
            source_path: source_path.to_path_buf(),
            from_utf16: source[..call.call_start].encode_utf16().count(),
            to_utf16: source[..call.call_end].encode_utf16().count(),
        };
        let Some(raw_path) = call.literal_path else {
            result.diagnostics.push(DraftImageDiagnostic {
                source_path: source_path.to_path_buf(),
                from_utf16: reference.from_utf16,
                to_utf16: reference.to_utf16,
                reason: "The image path is dynamic and cannot be replaced safely.".into(),
            });
            continue;
        };
        if raw_path.starts_with('@') || raw_path.contains("://") || raw_path.contains('\\') {
            result.diagnostics.push(DraftImageDiagnostic {
                source_path: source_path.to_path_buf(),
                from_utf16: reference.from_utf16,
                to_utf16: reference.to_utf16,
                reason: "Only literal local image paths are supported by Draft Preview.".into(),
            });
            continue;
        }

        let image_path = normalize_existing_path(
            &source_path
                .parent()
                .unwrap_or_else(|| Path::new(""))
                .join(&raw_path),
        );
        let project_root = normalize_existing_path(project_root);
        if !image_path.starts_with(&project_root) {
            result.diagnostics.push(DraftImageDiagnostic {
                source_path: source_path.to_path_buf(),
                from_utf16: reference.from_utf16,
                to_utf16: reference.to_utf16,
                reason: "The image resolves outside the current workspace and was not exposed to Draft Preview.".into(),
            });
            continue;
        }
        let Some((width, height, mime_type)) = read_image_dimensions(&image_path) else {
            result.diagnostics.push(DraftImageDiagnostic {
                source_path: source_path.to_path_buf(),
                from_utf16: reference.from_utf16,
                to_utf16: reference.to_utf16,
                reason: "The image dimensions or format could not be read, so its aspect ratio was not guessed.".into(),
            });
            continue;
        };
        if width == 0 || height == 0 {
            result.diagnostics.push(DraftImageDiagnostic {
                source_path: source_path.to_path_buf(),
                from_utf16: reference.from_utf16,
                to_utf16: reference.to_utf16,
                reason: "The image has invalid intrinsic dimensions.".into(),
            });
            continue;
        }
        let Ok(metadata) = fs::metadata(&image_path) else {
            result.diagnostics.push(DraftImageDiagnostic {
                source_path: source_path.to_path_buf(),
                from_utf16: reference.from_utf16,
                to_utf16: reference.to_utf16,
                reason: "The image file is unavailable.".into(),
            });
            continue;
        };
        let id = draft_asset_id(&image_path);
        let placeholder_dir = render_dir.join(".typsastra-draft-assets");
        if fs::create_dir_all(&placeholder_dir).is_err() {
            result.diagnostics.push(DraftImageDiagnostic {
                source_path: source_path.to_path_buf(),
                from_utf16: reference.from_utf16,
                to_utf16: reference.to_utf16,
                reason: "The private Draft Preview asset directory could not be created.".into(),
            });
            continue;
        }
        let placeholder_path = placeholder_dir.join(format!("{id}.svg"));
        let filename = image_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Image");
        if fs::write(&placeholder_path, placeholder_svg(width, height, filename)).is_err() {
            result.diagnostics.push(DraftImageDiagnostic {
                source_path: source_path.to_path_buf(),
                from_utf16: reference.from_utf16,
                to_utf16: reference.to_utf16,
                reason: "The ratio-preserving Draft Preview placeholder could not be written."
                    .into(),
            });
            continue;
        }

        let relative_placeholder = relative_path(
            destination_path.parent().unwrap_or(render_dir),
            &placeholder_path,
        )
        .unwrap_or_else(|| placeholder_path.clone())
        .to_string_lossy()
        .replace('\\', "/");
        let original_call = &source[call.call_start..call.call_end];
        let path_start = call.path_start - call.call_start;
        let path_end = call.path_end - call.call_start;
        let mut placeholder_call = String::with_capacity(original_call.len() + 64);
        placeholder_call.push_str(&original_call[..path_start]);
        placeholder_call.push('"');
        placeholder_call.push_str(&escape_typst_string(&relative_placeholder));
        placeholder_call.push('"');
        placeholder_call.push_str(&original_call[path_end..]);
        let generated = format!("link(\"{DRAFT_LINK_PREFIX}{id}\", {placeholder_call})");
        result.replacements.push(DraftReplacement {
            start: call.call_start,
            end: call.call_end,
            generated,
        });
        if let Some(asset) = result.assets.iter_mut().find(|asset| asset.id == id) {
            asset.references.push(reference);
        } else {
            result.assets.push(DraftImageAsset {
                id,
                path: image_path,
                mime_type,
                width,
                height,
                source_bytes: metadata.len(),
                estimated_decoded_bytes: u64::from(width)
                    .saturating_mul(u64::from(height))
                    .saturating_mul(4),
                references: vec![reference],
            });
        }
    }
    result
}

#[derive(Debug)]
struct ImageCall {
    call_start: usize,
    call_end: usize,
    literal_path: Option<String>,
    path_start: usize,
    path_end: usize,
}

fn collect_image_calls(node: &SyntaxNode, offset: usize, output: &mut Vec<ImageCall>) {
    if let Some(call) = node.cast::<FuncCall>() {
        if matches!(call.callee(), Expr::Ident(ident) if ident.as_str() == "image") {
            let first = call.args().items().next();
            let literal = match first {
                Some(Arg::Pos(Expr::Str(value))) => Some(value),
                _ => None,
            };
            if let Some(value) = literal {
                let value_node = value.to_untyped();
                if let Some(relative) = relative_node_offset(node, value_node, 0) {
                    output.push(ImageCall {
                        call_start: offset,
                        call_end: offset + node.len(),
                        literal_path: Some(value.get().to_string()),
                        path_start: offset + relative,
                        path_end: offset + relative + value_node.len(),
                    });
                }
            } else {
                output.push(ImageCall {
                    call_start: offset,
                    call_end: offset + node.len(),
                    literal_path: None,
                    path_start: offset,
                    path_end: offset,
                });
            }
            return;
        }
    }
    let mut child_offset = offset;
    for child in node.children() {
        collect_image_calls(child, child_offset, output);
        child_offset += child.len();
    }
}

fn relative_node_offset(root: &SyntaxNode, target: &SyntaxNode, offset: usize) -> Option<usize> {
    if std::ptr::eq(root, target) {
        return Some(offset);
    }
    let mut child_offset = offset;
    for child in root.children() {
        if let Some(found) = relative_node_offset(child, target, child_offset) {
            return Some(found);
        }
        child_offset += child.len();
    }
    None
}

fn draft_asset_id(path: &Path) -> String {
    let mut digest = Sha256::new();
    digest.update(path.to_string_lossy().as_bytes());
    format!("{:x}", digest.finalize())[..24].to_string()
}

fn normalize_existing_path(path: &Path) -> PathBuf {
    dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn read_image_dimensions(path: &Path) -> Option<(u32, u32, String)> {
    use std::io::Read;
    let file = fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(1024 * 1024).read_to_end(&mut bytes).ok()?;
    if bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some((
            u32::from_be_bytes(bytes[16..20].try_into().ok()?),
            u32::from_be_bytes(bytes[20..24].try_into().ok()?),
            "image/png".into(),
        ));
    }
    if bytes.len() >= 10 && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        return Some((
            u16::from_le_bytes(bytes[6..8].try_into().ok()?) as u32,
            u16::from_le_bytes(bytes[8..10].try_into().ok()?) as u32,
            "image/gif".into(),
        ));
    }
    if bytes.len() >= 26 && bytes.starts_with(b"BM") {
        return Some((
            i32::from_le_bytes(bytes[18..22].try_into().ok()?).unsigned_abs(),
            i32::from_le_bytes(bytes[22..26].try_into().ok()?).unsigned_abs(),
            "image/bmp".into(),
        ));
    }
    if bytes.len() >= 30
        && bytes.starts_with(b"RIFF")
        && &bytes[8..12] == b"WEBP"
        && &bytes[12..16] == b"VP8X"
    {
        return Some((
            1 + u32::from_le_bytes([bytes[24], bytes[25], bytes[26], 0]),
            1 + u32::from_le_bytes([bytes[27], bytes[28], bytes[29], 0]),
            "image/webp".into(),
        ));
    }
    if bytes.starts_with(b"\xff\xd8") {
        if let Some((width, height)) = jpeg_dimensions(&bytes) {
            return Some((width, height, "image/jpeg".into()));
        }
    }
    let text = std::str::from_utf8(&bytes).ok()?;
    if text.trim_start().starts_with("<svg") || text.contains("<svg") {
        if let Some((width, height)) = svg_dimensions(text) {
            return Some((width, height, "image/svg+xml".into()));
        }
    }
    None
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut cursor = 2usize;
    while cursor + 3 < bytes.len() {
        if bytes[cursor] != 0xff {
            cursor += 1;
            continue;
        }
        while cursor < bytes.len() && bytes[cursor] == 0xff {
            cursor += 1;
        }
        let marker = *bytes.get(cursor)?;
        cursor += 1;
        if marker == 0xd8 || marker == 0xd9 || marker == 0x01 {
            continue;
        }
        let length = u16::from_be_bytes(bytes.get(cursor..cursor + 2)?.try_into().ok()?) as usize;
        if length < 2 || cursor + length > bytes.len() {
            return None;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) && length >= 7
        {
            let height = u16::from_be_bytes(bytes[cursor + 3..cursor + 5].try_into().ok()?) as u32;
            let width = u16::from_be_bytes(bytes[cursor + 5..cursor + 7].try_into().ok()?) as u32;
            return Some((width, height));
        }
        cursor += length;
    }
    None
}

fn svg_dimensions(text: &str) -> Option<(u32, u32)> {
    let svg_start = text.find("<svg")?;
    let tag_end = text[svg_start..].find('>')? + svg_start;
    let tag = &text[svg_start..=tag_end];
    if let Some(view_box) = xml_attribute(tag, "viewBox") {
        let values = view_box
            .split(|character: char| character.is_ascii_whitespace() || character == ',')
            .filter_map(|value| value.parse::<f64>().ok())
            .collect::<Vec<_>>();
        if values.len() == 4 && values[2] > 0.0 && values[3] > 0.0 {
            return Some((values[2].round() as u32, values[3].round() as u32));
        }
    }
    let width = numeric_svg_attribute(tag, "width")?;
    let height = numeric_svg_attribute(tag, "height")?;
    Some((width, height))
}

fn numeric_svg_attribute(tag: &str, name: &str) -> Option<u32> {
    let value = xml_attribute(tag, name)?;
    let number = value
        .trim()
        .trim_end_matches(|character: char| character.is_ascii_alphabetic() || character == '%')
        .parse::<f64>()
        .ok()?;
    (number > 0.0).then_some(number.round() as u32)
}

fn xml_attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let marker = format!("{name}=");
    let start = tag.find(&marker)? + marker.len();
    let quote = tag.as_bytes().get(start).copied()?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    let content_start = start + 1;
    let end = tag[content_start..].find(quote as char)? + content_start;
    Some(&tag[content_start..end])
}

fn placeholder_svg(width: u32, height: u32, filename: &str) -> String {
    let label = escape_xml(filename);
    let font_size = (width.min(height) as f64 * 0.055).clamp(12.0, 72.0);
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
<rect x="1" y="1" width="{rect_width}" height="{rect_height}" fill="#f2f3f5" stroke="#7b8491" stroke-width="{stroke}"/>
<path d="M {icon_x} {icon_y2} L {icon_x2} {icon_y} L {icon_x3} {icon_y2} Z" fill="#a8afb8"/>
<text x="50%" y="58%" text-anchor="middle" font-family="sans-serif" font-size="{font_size}" fill="#505762">{label}</text>
</svg>"##,
        rect_width = width.saturating_sub(2),
        rect_height = height.saturating_sub(2),
        stroke = (width.min(height) as f64 * 0.006).clamp(1.0, 8.0),
        icon_x = width as f64 * 0.42,
        icon_x2 = width as f64 * 0.5,
        icon_x3 = width as f64 * 0.58,
        icon_y = height as f64 * 0.30,
        icon_y2 = height as f64 * 0.43,
    )
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn escape_typst_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn relative_path(from: &Path, to: &Path) -> Option<PathBuf> {
    let from = from.components().collect::<Vec<_>>();
    let to = to.components().collect::<Vec<_>>();
    if matches!((from.first(), to.first()), (Some(Component::Prefix(left)), Some(Component::Prefix(right))) if left != right)
    {
        return None;
    }
    let common = from
        .iter()
        .zip(&to)
        .take_while(|(left, right)| left == right)
        .count();
    let mut result = PathBuf::new();
    for component in &from[common..] {
        if !matches!(component, Component::CurDir) {
            result.push("..");
        }
    }
    for component in &to[common..] {
        result.push(component.as_os_str());
    }
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_ratio_preserving_placeholder_for_literal_image() {
        let workspace = tempfile::tempdir().unwrap();
        let source = workspace.path().join("main.typ");
        let destination = workspace.path().join("cache/render/main.typ");
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        let image = workspace.path().join("wide.png");
        let mut png = vec![0u8; 24];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[16..20].copy_from_slice(&1600u32.to_be_bytes());
        png[20..24].copy_from_slice(&900u32.to_be_bytes());
        fs::write(&image, png).unwrap();
        let prepared = prepare_draft_images(
            workspace.path(),
            &source,
            &destination,
            &workspace.path().join("cache/render"),
            "#image(\"wide.png\", width: 80%)",
        );
        assert_eq!(prepared.assets[0].width, 1600);
        assert_eq!(prepared.assets[0].height, 900);
        assert!(prepared.replacements[0]
            .generated
            .contains("link(\"https://draft-preview.typsastra.invalid/"));
        assert!(prepared.replacements[0].generated.contains("width: 80%"));
        let svg = fs::read_to_string(
            workspace
                .path()
                .join("cache/render/.typsastra-draft-assets")
                .join(format!("{}.svg", prepared.assets[0].id)),
        )
        .unwrap();
        assert!(svg.contains("viewBox=\"0 0 1600 900\""));
    }

    #[test]
    fn leaves_dynamic_images_unmodified() {
        let workspace = tempfile::tempdir().unwrap();
        let prepared = prepare_draft_images(
            workspace.path(),
            &workspace.path().join("main.typ"),
            &workspace.path().join("cache/render/main.typ"),
            &workspace.path().join("cache/render"),
            "#let path = \"wide.png\"\n#image(path)",
        );
        assert!(prepared.replacements.is_empty());
        assert_eq!(prepared.diagnostics.len(), 1);
    }

    #[test]
    fn ignores_image_text_in_comments_and_strings() {
        let workspace = tempfile::tempdir().unwrap();
        let prepared = prepare_draft_images(
            workspace.path(),
            &workspace.path().join("main.typ"),
            &workspace.path().join("cache/render/main.typ"),
            &workspace.path().join("cache/render"),
            "// #image(\"missing.png\")\n#let example = \"#image(\\\"missing.png\\\")\"",
        );
        assert!(prepared.replacements.is_empty());
        assert!(prepared.diagnostics.is_empty());
    }

    #[test]
    fn rejects_images_outside_the_workspace() {
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let image = outside.path().join("private.png");
        let mut png = vec![0u8; 24];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[16..20].copy_from_slice(&400u32.to_be_bytes());
        png[20..24].copy_from_slice(&300u32.to_be_bytes());
        fs::write(&image, png).unwrap();
        let source = format!("#image(\"{}\")", image.to_string_lossy().replace('\\', "/"));
        let prepared = prepare_draft_images(
            workspace.path(),
            &workspace.path().join("main.typ"),
            &workspace.path().join("cache/render/main.typ"),
            &workspace.path().join("cache/render"),
            &source,
        );
        assert!(prepared.replacements.is_empty());
        assert!(prepared.diagnostics[0].reason.contains("outside"));
    }
}
