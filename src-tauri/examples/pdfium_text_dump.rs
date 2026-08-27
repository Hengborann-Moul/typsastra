use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextChar {
    text: String,
    left: Option<f32>,
    bottom: Option<f32>,
    right: Option<f32>,
    top: Option<f32>,
    font_size: f32,
    font_family: String,
    font_weight: Option<u32>,
    italic: bool,
    color: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PageText {
    width: f32,
    height: f32,
    chars: Vec<TextChar>,
    semantic_markers: Vec<serde_json::Value>,
}

fn main() -> Result<(), String> {
    let path = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or_else(|| "Usage: pdfium_text_dump <pdf-path>".to_string())?;
    let pdfium = pdfium_bundled::bind_bundled()
        .map_err(|error| format!("Failed to initialize bundled PDFium: {error}"))?;
    let document = pdfium
        .load_pdf_from_file(&path, None)
        .map_err(|error| format!("PDFium could not open {}: {error}", path.display()))?;
    let mut pages = Vec::new();
    for page in document.pages().iter() {
        let text = page
            .text()
            .map_err(|error| format!("PDFium could not extract page text: {error}"))?;
        let chars = text
            .chars()
            .iter()
            .filter_map(|char| {
                let text = char.unicode_string()?;
                let bounds = char.loose_bounds().ok();
                Some(TextChar {
                    text,
                    left: bounds.map(|value| value.left().value),
                    bottom: bounds.map(|value| value.bottom().value),
                    right: bounds.map(|value| value.right().value),
                    top: bounds.map(|value| value.top().value),
                    font_size: char.scaled_font_size().value.abs(),
                    font_family: char.font_name(),
                    font_weight: None,
                    italic: char.font_is_italic(),
                    color: char.fill_color().ok().map(|color| {
                        format!(
                            "#{:02x}{:02x}{:02x}",
                            color.red(),
                            color.green(),
                            color.blue(),
                        )
                    }),
                })
            })
            .collect();
        pages.push(PageText {
            width: page.width().value,
            height: page.height().value,
            chars,
            semantic_markers: Vec::new(),
        });
    }
    println!(
        "{}",
        serde_json::to_string(&pages)
            .map_err(|error| format!("Could not serialize PDFium text: {error}"))?
    );
    Ok(())
}
