#[tauri::command]
pub fn write_formatted_clipboard(plain_text: String, html: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("Failed to open the system clipboard: {error}"))?;
    clipboard
        .set_html(html, Some(plain_text))
        .map_err(|error| format!("Failed to copy formatted text: {error}"))
}
