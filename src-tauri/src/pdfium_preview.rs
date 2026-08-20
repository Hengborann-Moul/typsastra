use pdfium_bundled::pdfium_render::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};

#[derive(Default)]
pub struct PdfiumPreviewState {
    next_document_id: AtomicU64,
    worker: Mutex<Option<mpsc::Sender<PdfiumRequest>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfiumPageDimensions {
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfiumDocumentInfo {
    pub document_id: u64,
    pub byte_length: u64,
    pub pages: Vec<PdfiumPageDimensions>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfiumTextChar {
    pub text: String,
    pub left: Option<f32>,
    pub bottom: Option<f32>,
    pub right: Option<f32>,
    pub top: Option<f32>,
    pub font_size: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfiumPageText {
    pub width: f32,
    pub height: f32,
    pub chars: Vec<PdfiumTextChar>,
}

enum PdfiumRequest {
    Open {
        document_id: u64,
        path: PathBuf,
        delete_on_close: bool,
        response: mpsc::Sender<Result<PdfiumDocumentInfo, String>>,
    },
    Render {
        document_id: u64,
        page_no: u16,
        width: u16,
        height: u16,
        response: mpsc::Sender<Result<Vec<u8>, String>>,
    },
    Text {
        document_id: u64,
        page_no: u16,
        response: mpsc::Sender<Result<PdfiumPageText, String>>,
    },
    Close {
        document_id: u64,
        response: mpsc::Sender<Result<(), String>>,
    },
}

struct OpenPdfiumDocument<'a> {
    document: PdfDocument<'a>,
    path: PathBuf,
    delete_on_close: bool,
}

impl PdfiumPreviewState {
    fn worker(&self) -> Result<mpsc::Sender<PdfiumRequest>, String> {
        let mut worker = self
            .worker
            .lock()
            .map_err(|_| "The PDFium preview worker is unavailable.".to_string())?;
        if let Some(sender) = worker.as_ref() {
            return Ok(sender.clone());
        }

        let (sender, receiver) = mpsc::channel();
        std::thread::Builder::new()
            .name("typsastra-pdfium-preview".to_string())
            .spawn(move || run_pdfium_worker(receiver))
            .map_err(|error| format!("Failed to start PDFium preview: {error}"))?;
        *worker = Some(sender.clone());
        Ok(sender)
    }

    fn request<T>(
        &self,
        create: impl FnOnce(mpsc::Sender<Result<T, String>>) -> PdfiumRequest,
    ) -> Result<T, String> {
        let worker = self.worker()?;
        let (response, receiver) = mpsc::channel();
        worker
            .send(create(response))
            .map_err(|_| "The PDFium preview worker stopped unexpectedly.".to_string())?;
        receiver
            .recv()
            .map_err(|_| "The PDFium preview worker did not return a response.".to_string())?
    }
}

fn run_pdfium_worker(receiver: mpsc::Receiver<PdfiumRequest>) {
    let pdfium = match pdfium_bundled::bind_bundled() {
        Ok(pdfium) => pdfium,
        Err(error) => {
            let message = format!("Failed to initialize bundled PDFium: {error}");
            for request in receiver {
                reject_request(request, &message);
            }
            return;
        }
    };
    let mut documents = HashMap::new();

    for request in receiver {
        match request {
            PdfiumRequest::Open {
                document_id,
                path,
                delete_on_close,
                response,
            } => {
                let result = (|| {
                    let byte_length = std::fs::metadata(&path)
                        .map_err(|error| format!("Failed to inspect PDF: {error}"))?
                        .len();
                    let document = pdfium
                        .load_pdf_from_file(&path, None)
                        .map_err(|error| format!("PDFium could not open the document: {error}"))?;
                    let pages = document
                        .pages()
                        .iter()
                        .map(|page| PdfiumPageDimensions {
                            width: page.width().value,
                            height: page.height().value,
                        })
                        .collect();
                    documents.insert(
                        document_id,
                        OpenPdfiumDocument {
                            document,
                            path,
                            delete_on_close,
                        },
                    );
                    Ok(PdfiumDocumentInfo {
                        document_id,
                        byte_length,
                        pages,
                    })
                })();
                let _ = response.send(result);
            }
            PdfiumRequest::Render {
                document_id,
                page_no,
                width,
                height,
                response,
            } => {
                let result = render_page(&documents, document_id, page_no, width, height);
                let _ = response.send(result);
            }
            PdfiumRequest::Text {
                document_id,
                page_no,
                response,
            } => {
                let result = extract_page_text(&documents, document_id, page_no);
                let _ = response.send(result);
            }
            PdfiumRequest::Close {
                document_id,
                response,
            } => {
                let result = close_document(&mut documents, document_id);
                let _ = response.send(result);
            }
        }
    }
}

fn reject_request(request: PdfiumRequest, message: &str) {
    match request {
        PdfiumRequest::Open { response, .. } => {
            let _ = response.send(Err(message.to_string()));
        }
        PdfiumRequest::Render { response, .. } => {
            let _ = response.send(Err(message.to_string()));
        }
        PdfiumRequest::Text { response, .. } => {
            let _ = response.send(Err(message.to_string()));
        }
        PdfiumRequest::Close { response, .. } => {
            let _ = response.send(Err(message.to_string()));
        }
    }
}

fn close_document<'a>(
    documents: &mut HashMap<u64, OpenPdfiumDocument<'a>>,
    document_id: u64,
) -> Result<(), String> {
    let Some(open_document) = documents.remove(&document_id) else {
        return Ok(());
    };
    let path = open_document.path.clone();
    let delete_on_close = open_document.delete_on_close;
    drop(open_document);
    if delete_on_close {
        std::fs::remove_file(&path).map_err(|error| {
            format!("Failed to remove temporary PDF {}: {error}", path.display())
        })?;
    }
    Ok(())
}

fn get_page<'a>(
    documents: &HashMap<u64, OpenPdfiumDocument<'a>>,
    document_id: u64,
    page_no: u16,
) -> Result<PdfPage<'a>, String> {
    let document = documents
        .get(&document_id)
        .ok_or_else(|| "The PDFium document is no longer open.".to_string())?;
    if page_no == 0 {
        return Err("PDF page numbers start at one.".to_string());
    }
    document
        .document
        .pages()
        .get(i32::from(page_no - 1))
        .map_err(|error| format!("PDFium could not open page {page_no}: {error}"))
}

fn render_page<'a>(
    documents: &HashMap<u64, OpenPdfiumDocument<'a>>,
    document_id: u64,
    page_no: u16,
    width: u16,
    height: u16,
) -> Result<Vec<u8>, String> {
    let page = get_page(documents, document_id, page_no)?;
    let bitmap = page
        .render_with_config(
            &PdfRenderConfig::new()
                .set_fixed_size(width.max(1) as i32, height.max(1) as i32)
                .render_annotations(true),
        )
        .map_err(|error| format!("PDFium could not render page {page_no}: {error}"))?;
    let image = bitmap
        .as_image()
        .map_err(|error| format!("PDFium could not read page pixels: {error}"))?;
    let mut bytes = Cursor::new(Vec::new());
    image
        .write_to(&mut bytes, image::ImageFormat::Png)
        .map_err(|error| format!("Failed to encode the PDFium page: {error}"))?;
    Ok(bytes.into_inner())
}

fn extract_page_text<'a>(
    documents: &HashMap<u64, OpenPdfiumDocument<'a>>,
    document_id: u64,
    page_no: u16,
) -> Result<PdfiumPageText, String> {
    let page = get_page(documents, document_id, page_no)?;
    let page_width = page.width().value;
    let page_height = page.height().value;
    let text = page
        .text()
        .map_err(|error| format!("PDFium could not extract page {page_no} text: {error}"))?;
    let chars = text
        .chars()
        .iter()
        .filter_map(|char| {
            let text = char.unicode_string()?;
            let bounds = char.loose_bounds().ok();
            Some(PdfiumTextChar {
                text,
                left: bounds.map(|bounds| bounds.left().value),
                bottom: bounds.map(|bounds| bounds.bottom().value),
                right: bounds.map(|bounds| bounds.right().value),
                top: bounds.map(|bounds| bounds.top().value),
                font_size: char.scaled_font_size().value.abs(),
            })
        })
        .collect();
    Ok(PdfiumPageText {
        width: page_width,
        height: page_height,
        chars,
    })
}

#[tauri::command]
pub fn open_pdfium_document(
    state: tauri::State<'_, PdfiumPreviewState>,
    path: String,
    delete_on_close: bool,
) -> Result<PdfiumDocumentInfo, String> {
    let document_id = state.next_document_id.fetch_add(1, Ordering::Relaxed) + 1;
    let path = std::fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(path));
    state.request(|response| PdfiumRequest::Open {
        document_id,
        path,
        delete_on_close,
        response,
    })
}

#[tauri::command]
pub fn render_pdfium_page(
    state: tauri::State<'_, PdfiumPreviewState>,
    document_id: u64,
    page_no: u16,
    width: u16,
    height: u16,
) -> Result<tauri::ipc::Response, String> {
    let bytes = state.request(|response| PdfiumRequest::Render {
        document_id,
        page_no,
        width,
        height,
        response,
    })?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn get_pdfium_page_text(
    state: tauri::State<'_, PdfiumPreviewState>,
    document_id: u64,
    page_no: u16,
) -> Result<PdfiumPageText, String> {
    state.request(|response| PdfiumRequest::Text {
        document_id,
        page_no,
        response,
    })
}

#[tauri::command]
pub fn close_pdfium_document(
    state: tauri::State<'_, PdfiumPreviewState>,
    document_id: u64,
) -> Result<(), String> {
    state.request(|response| PdfiumRequest::Close {
        document_id,
        response,
    })
}
