use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
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
    _destination_path: &Path,
    _render_dir: &Path,
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

        let unresolved_image_path = source_path
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(&raw_path);
        let Some(image_io_path) = canonical_io_path(&unresolved_image_path) else {
            result.diagnostics.push(DraftImageDiagnostic {
                source_path: source_path.to_path_buf(),
                from_utf16: reference.from_utf16,
                to_utf16: reference.to_utf16,
                reason: "The image file is unavailable.".into(),
            });
            continue;
        };
        let Some(project_io_root) = canonical_io_path(project_root) else {
            result.diagnostics.push(DraftImageDiagnostic {
                source_path: source_path.to_path_buf(),
                from_utf16: reference.from_utf16,
                to_utf16: reference.to_utf16,
                reason: "The workspace root could not be resolved safely.".into(),
            });
            continue;
        };
        if !image_io_path.starts_with(&project_io_root) {
            result.diagnostics.push(DraftImageDiagnostic {
                source_path: source_path.to_path_buf(),
                from_utf16: reference.from_utf16,
                to_utf16: reference.to_utf16,
                reason: "The image resolves outside the current workspace and was not exposed to Draft Preview.".into(),
            });
            continue;
        }
        let image_path = display_path(&image_io_path);
        let Some((width, height, mime_type)) = read_image_dimensions(&image_io_path) else {
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
        let Ok(metadata) = fs::metadata(&image_io_path) else {
            result.diagnostics.push(DraftImageDiagnostic {
                source_path: source_path.to_path_buf(),
                from_utf16: reference.from_utf16,
                to_utf16: reference.to_utf16,
                reason: "The image file is unavailable.".into(),
            });
            continue;
        };
        let id = draft_asset_id(&image_path);
        let mut block_arguments = call
            .layout_arguments
            .iter()
            .map(|(start, end)| source[*start..*end].trim())
            .filter(|argument| !argument.is_empty())
            .map(|argument| format!("{argument},"))
            .collect::<Vec<_>>();
        if !call.has_width {
            let normalized_width = f64::from(width) / f64::from(height) * 100.0;
            block_arguments.push(format!("width: {normalized_width:.6}pt,"));
        }
        if !call.has_height {
            block_arguments.push("height: 100pt,".into());
        }
        let generated = format!(
            "link(\"{DRAFT_LINK_PREFIX}{id}\", block({arguments}stroke: 1pt + rgb(\"#7b8491\"), inset: 4pt, clip: true)[#align(center + horizon)[#text(size: 8pt, fill: rgb(\"#505762\"))[#raw(\"{label}\")]]])",
            arguments = block_arguments.join(" "),
            label = escape_typst_string(&raw_path),
        );
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
    layout_arguments: Vec<(usize, usize)>,
    has_width: bool,
    has_height: bool,
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
                if let Some(_relative) = relative_node_offset(node, value_node, 0) {
                    let mut layout_arguments = Vec::new();
                    let mut has_width = false;
                    let mut has_height = false;
                    for argument in call.args().items() {
                        let Arg::Named(named) = argument else {
                            continue;
                        };
                        let name = named.name().as_str();
                        if name != "width" && name != "height" {
                            continue;
                        }
                        has_width |= name == "width";
                        has_height |= name == "height";
                        let argument_node = named.to_untyped();
                        if let Some(argument_relative) =
                            relative_node_offset(node, argument_node, 0)
                        {
                            layout_arguments.push((
                                offset + argument_relative,
                                offset + argument_relative + argument_node.len(),
                            ));
                        }
                    }
                    output.push(ImageCall {
                        call_start: offset,
                        call_end: offset + node.len(),
                        literal_path: Some(value.get().to_string()),
                        layout_arguments,
                        has_width,
                        has_height,
                    });
                }
            } else {
                output.push(ImageCall {
                    call_start: offset,
                    call_end: offset + node.len(),
                    literal_path: None,
                    layout_arguments: Vec::new(),
                    has_width: false,
                    has_height: false,
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

fn canonical_io_path(path: &Path) -> Option<PathBuf> {
    fs::canonicalize(path).ok()
}

fn display_path(path: &Path) -> PathBuf {
    dunce::simplified(path).to_path_buf()
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

fn escape_typst_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
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
            "#image(\"wide.png\", width: 80%, height: 6cm, fit: \"cover\")",
        );
        assert_eq!(prepared.assets[0].width, 1600);
        assert_eq!(prepared.assets[0].height, 900);
        assert!(prepared.replacements[0]
            .generated
            .contains("link(\"https://draft-preview.typsastra.invalid/"));
        assert!(prepared.replacements[0].generated.contains("width: 80%"));
        assert!(prepared.replacements[0].generated.contains("height: 6cm"));
        assert!(prepared.replacements[0]
            .generated
            .contains("#raw(\"wide.png\")"));
        assert!(prepared.replacements[0]
            .generated
            .contains("text(size: 8pt"));
        assert!(!prepared.replacements[0].generated.contains("fit:"));
    }

    #[test]
    fn derives_ratio_only_dimensions_when_image_size_is_implicit() {
        let workspace = tempfile::tempdir().unwrap();
        let image = workspace.path().join("wide.png");
        let mut png = vec![0u8; 24];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[16..20].copy_from_slice(&1600u32.to_be_bytes());
        png[20..24].copy_from_slice(&900u32.to_be_bytes());
        fs::write(&image, png).unwrap();
        let prepared = prepare_draft_images(
            workspace.path(),
            &workspace.path().join("main.typ"),
            &workspace.path().join("cache/render/main.typ"),
            &workspace.path().join("cache/render"),
            "#image(\"wide.png\")",
        );
        assert!(prepared.replacements[0]
            .generated
            .contains("width: 177.777778pt"));
        assert!(prepared.replacements[0].generated.contains("height: 100pt"));
    }

    #[test]
    fn replaces_images_beyond_the_legacy_windows_path_limit() {
        let workspace = tempfile::tempdir().unwrap();
        let destination = workspace.path().join("cache/render/main.typ");
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        let long_relative = (0..9).fold(PathBuf::from("images"), |path, index| {
            path.join(format!("descriptive-image-directory-{index:02}"))
        });
        let workspace_io = fs::canonicalize(workspace.path()).unwrap();
        let long_directory_io = workspace_io.join(&long_relative);
        fs::create_dir_all(&long_directory_io).unwrap();
        let image_io = long_directory_io.join("photo.png");
        let mut png = vec![0u8; 24];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[16..20].copy_from_slice(&1280u32.to_be_bytes());
        png[20..24].copy_from_slice(&960u32.to_be_bytes());
        fs::write(&image_io, png).unwrap();
        let literal = long_relative
            .join("photo.png")
            .to_string_lossy()
            .replace('\\', "/");
        let source_text = format!("#image(\"{literal}\")");

        let prepared = prepare_draft_images(
            workspace.path(),
            &workspace.path().join("main.typ"),
            &destination,
            &workspace.path().join("cache/render"),
            &source_text,
        );

        assert!(
            workspace.path().join(&long_relative).as_os_str().len() > 260,
            "the fixture must exercise a path beyond the legacy Windows limit"
        );
        assert_eq!(prepared.replacements.len(), 1);
        assert_eq!(prepared.assets.len(), 1);
        assert!(prepared.diagnostics.is_empty());
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
