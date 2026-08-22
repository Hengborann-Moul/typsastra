use pdfium_bundled::pdfium_render::prelude::*;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
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
    pub font_family: String,
    pub font_weight: Option<u32>,
    pub italic: bool,
    pub color: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfiumPageText {
    pub width: f32,
    pub height: f32,
    pub chars: Vec<PdfiumTextChar>,
    pub semantic_markers: Vec<PdfiumSemanticMarker>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfiumSemanticMarker {
    pub block_id: Option<u64>,
    pub x: f32,
    pub y: f32,
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
    semantic_markers: HashMap<u16, Vec<PdfiumSemanticMarker>>,
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
                    let semantic_markers = load_semantic_markers(&path).unwrap_or_default();
                    documents.insert(
                        document_id,
                        OpenPdfiumDocument {
                            document,
                            path,
                            delete_on_close,
                            semantic_markers,
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
                font_family: char.font_name(),
                font_weight: char.font_weight().map(pdf_font_weight_value),
                italic: char.font_is_italic(),
                color: char.fill_color().ok().map(|color| {
                    format!(
                        "#{:02x}{:02x}{:02x}",
                        color.red(),
                        color.green(),
                        color.blue()
                    )
                }),
            })
        })
        .collect();
    Ok(PdfiumPageText {
        width: page_width,
        height: page_height,
        chars,
        semantic_markers: documents
            .get(&document_id)
            .and_then(|document| document.semantic_markers.get(&page_no))
            .cloned()
            .unwrap_or_default(),
    })
}

fn pdf_font_weight_value(weight: PdfFontWeight) -> u32 {
    match weight {
        PdfFontWeight::Weight100 => 100,
        PdfFontWeight::Weight200 => 200,
        PdfFontWeight::Weight300 => 300,
        PdfFontWeight::Weight400Normal => 400,
        PdfFontWeight::Weight500 => 500,
        PdfFontWeight::Weight600 => 600,
        PdfFontWeight::Weight700Bold => 700,
        PdfFontWeight::Weight800 => 800,
        PdfFontWeight::Weight900 => 900,
        PdfFontWeight::Custom(value) => value,
    }
}

fn load_semantic_markers(
    path: &std::path::Path,
) -> Result<HashMap<u16, Vec<PdfiumSemanticMarker>>, String> {
    let document = lopdf::Document::load(path)
        .map_err(|error| format!("Failed to inspect tagged PDF structure: {error}"))?;
    let semantic_blocks = load_semantic_blocks_from_document(&document)?;
    let mut markers = HashMap::new();
    for (page_index, page_id) in document.get_pages() {
        let Ok(page_no) = u16::try_from(page_index) else {
            continue;
        };
        let content = document
            .get_page_content(page_id)
            .map_err(|error| format!("Failed to read tagged PDF page {page_no}: {error}"))?;
        let operations = lopdf::content::Content::decode(&content)
            .map_err(|error| format!("Failed to decode tagged PDF page {page_no}: {error}"))?
            .operations;
        let page_markers = semantic_markers_from_operations(
            &operations,
            semantic_blocks.get(&page_no).map(Vec::as_slice),
        );
        if !page_markers.is_empty() {
            markers.insert(page_no, page_markers);
        }
    }
    Ok(markers)
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct PdfTransform {
    a: f32,
    b: f32,
    c: f32,
    d: f32,
    e: f32,
    f: f32,
}

impl PdfTransform {
    const IDENTITY: Self = Self {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: 0.0,
        f: 0.0,
    };

    fn from_operands(operands: &[lopdf::Object]) -> Option<Self> {
        if operands.len() < 6 {
            return None;
        }
        Some(Self {
            a: pdf_number(&operands[0])?,
            b: pdf_number(&operands[1])?,
            c: pdf_number(&operands[2])?,
            d: pdf_number(&operands[3])?,
            e: pdf_number(&operands[4])?,
            f: pdf_number(&operands[5])?,
        })
    }

    fn then(self, next: Self) -> Self {
        Self {
            a: self.a * next.a + self.c * next.b,
            b: self.b * next.a + self.d * next.b,
            c: self.a * next.c + self.c * next.d,
            d: self.b * next.c + self.d * next.d,
            e: self.a * next.e + self.c * next.f + self.e,
            f: self.b * next.e + self.d * next.f + self.f,
        }
    }

    fn apply(self, x: f32, y: f32) -> (f32, f32) {
        (
            self.a * x + self.c * y + self.e,
            self.b * x + self.d * y + self.f,
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MarkedContentKind {
    Semantic(u64),
    Artifact,
    Unmapped,
}

#[derive(Clone, Copy, Debug)]
struct MarkedContentState {
    kind: MarkedContentKind,
    marker_emitted: bool,
}

fn semantic_markers_from_operations(
    operations: &[lopdf::content::Operation],
    blocks: Option<&[Option<u64>]>,
) -> Vec<PdfiumSemanticMarker> {
    let mut markers = Vec::new();
    let mut transform = PdfTransform::IDENTITY;
    let mut transform_stack = Vec::new();
    let mut text_matrix = PdfTransform::IDENTITY;
    let mut marked_content = Vec::<MarkedContentState>::new();

    for operation in operations {
        match operation.operator.as_str() {
            "q" => transform_stack.push(transform),
            "Q" => transform = transform_stack.pop().unwrap_or(PdfTransform::IDENTITY),
            "cm" => {
                if let Some(matrix) = PdfTransform::from_operands(&operation.operands) {
                    transform = transform.then(matrix);
                }
            }
            "BT" => text_matrix = PdfTransform::IDENTITY,
            "Tm" => {
                if let Some(matrix) = PdfTransform::from_operands(&operation.operands) {
                    text_matrix = matrix;
                }
            }
            "Td" | "TD" => {
                if operation.operands.len() >= 2 {
                    if let (Some(x), Some(y)) = (
                        pdf_number(&operation.operands[0]),
                        pdf_number(&operation.operands[1]),
                    ) {
                        text_matrix = text_matrix.then(PdfTransform {
                            e: x,
                            f: y,
                            ..PdfTransform::IDENTITY
                        });
                    }
                }
            }
            "BDC" | "BMC" => {
                let artifact = matches!(
                    operation.operands.first(),
                    Some(lopdf::Object::Name(name)) if name.as_slice() == b"Artifact"
                );
                let mcid = operation.operands.iter().find_map(|operand| match operand {
                    lopdf::Object::Dictionary(dictionary) => dictionary
                        .get(b"MCID")
                        .ok()
                        .and_then(|value| value.as_i64().ok()),
                    _ => None,
                });
                let block_id = mcid.and_then(|mcid| {
                    usize::try_from(mcid)
                        .ok()
                        .and_then(|index| blocks.and_then(|blocks| blocks.get(index)))
                        .copied()
                        .flatten()
                });
                let kind = if artifact {
                    MarkedContentKind::Artifact
                } else if let Some(block_id) = block_id {
                    MarkedContentKind::Semantic(block_id)
                } else {
                    MarkedContentKind::Unmapped
                };
                marked_content.push(MarkedContentState {
                    kind,
                    marker_emitted: false,
                });
            }
            "EMC" => {
                marked_content.pop();
            }
            "Tj" | "TJ" | "'" | "\"" => {
                let Some(index) = marked_content.iter().rposition(|state| {
                    !state.marker_emitted && state.kind != MarkedContentKind::Unmapped
                }) else {
                    continue;
                };
                let (x, y) = transform.apply(text_matrix.e, text_matrix.f);
                let block_id = match marked_content[index].kind {
                    MarkedContentKind::Semantic(block_id) => Some(block_id),
                    MarkedContentKind::Artifact => None,
                    MarkedContentKind::Unmapped => unreachable!(),
                };
                markers.push(PdfiumSemanticMarker { block_id, x, y });
                marked_content[index].marker_emitted = true;
            }
            _ => {}
        }
    }

    markers
}

fn pdf_number(object: &lopdf::Object) -> Option<f32> {
    match object {
        lopdf::Object::Integer(value) => Some(*value as f32),
        lopdf::Object::Real(value) => Some(*value),
        _ => None,
    }
}

fn load_semantic_blocks_from_document(
    document: &lopdf::Document,
) -> Result<HashMap<u16, Vec<Option<u64>>>, String> {
    let pages: HashMap<lopdf::ObjectId, u16> = document
        .get_pages()
        .into_iter()
        .filter_map(|(page_no, object_id)| {
            u16::try_from(page_no)
                .ok()
                .map(|page_no| (object_id, page_no))
        })
        .collect();
    let root = document
        .catalog()
        .and_then(|catalog| catalog.get(b"StructTreeRoot"))
        .map_err(|error| format!("PDF does not expose a structure tree: {error}"))?
        .clone();

    let mut blocks = HashMap::<u16, BTreeMap<i64, u64>>::new();
    let mut next_block = 1_u64;
    visit_structure_object(
        &document,
        &pages,
        root,
        None,
        None,
        &mut next_block,
        &mut blocks,
    );

    Ok(blocks
        .into_iter()
        .map(|(page_no, mcids)| {
            let Some(max_mcid) = mcids
                .keys()
                .copied()
                .max()
                .and_then(|value| usize::try_from(value).ok())
            else {
                return (page_no, Vec::new());
            };
            let mut ordered = vec![None; max_mcid + 1];
            for (mcid, block_id) in mcids {
                if let Ok(index) = usize::try_from(mcid) {
                    ordered[index] = Some(block_id);
                }
            }
            (page_no, ordered)
        })
        .collect())
}

#[allow(clippy::too_many_arguments)]
fn visit_structure_object(
    document: &lopdf::Document,
    pages: &HashMap<lopdf::ObjectId, u16>,
    object: lopdf::Object,
    inherited_page: Option<u16>,
    inherited_block: Option<u64>,
    next_block: &mut u64,
    blocks: &mut HashMap<u16, BTreeMap<i64, u64>>,
) {
    use lopdf::Object;

    let resolved = match object {
        Object::Reference(object_id) => document.get_object(object_id).ok().cloned(),
        object => Some(object),
    };
    let Some(resolved) = resolved else { return };
    match resolved {
        Object::Integer(mcid) => {
            if let (Some(page_no), Some(block_id)) = (inherited_page, inherited_block) {
                blocks.entry(page_no).or_default().insert(mcid, block_id);
            }
        }
        Object::Array(children) => {
            for child in children {
                visit_structure_object(
                    document,
                    pages,
                    child,
                    inherited_page,
                    inherited_block,
                    next_block,
                    blocks,
                );
            }
        }
        Object::Dictionary(dictionary) => {
            let page_no = dictionary
                .get(b"Pg")
                .ok()
                .and_then(|page| page.as_reference().ok())
                .and_then(|page| pages.get(&page).copied())
                .or(inherited_page);
            let kind = dictionary
                .get(b"S")
                .ok()
                .and_then(|kind| kind.as_name().ok())
                .unwrap_or_default();
            let block_id = if is_semantic_text_block(kind) {
                let block_id = *next_block;
                *next_block += 1;
                Some(block_id)
            } else {
                inherited_block
            };

            if let Ok(mcid) = dictionary.get(b"MCID").and_then(Object::as_i64) {
                if let (Some(page_no), Some(block_id)) = (page_no, block_id) {
                    blocks.entry(page_no).or_default().insert(mcid, block_id);
                }
            }
            if let Ok(children) = dictionary.get(b"K") {
                visit_structure_object(
                    document,
                    pages,
                    children.clone(),
                    page_no,
                    block_id,
                    next_block,
                    blocks,
                );
            }
        }
        Object::Stream(stream) => visit_structure_object(
            document,
            pages,
            Object::Dictionary(stream.dict),
            inherited_page,
            inherited_block,
            next_block,
            blocks,
        ),
        _ => {}
    }
}

fn is_semantic_text_block(kind: &[u8]) -> bool {
    matches!(
        kind,
        b"P" | b"H"
            | b"H1"
            | b"H2"
            | b"H3"
            | b"H4"
            | b"H5"
            | b"H6"
            | b"LBody"
            | b"LI"
            | b"Caption"
            | b"BlockQuote"
    )
}

#[cfg(test)]
mod semantic_marker_tests {
    use super::{semantic_markers_from_operations, PdfTransform};
    use lopdf::content::Operation;
    use lopdf::{Dictionary, Object};

    fn numbers(values: [f32; 6]) -> Vec<Object> {
        values.into_iter().map(Object::Real).collect()
    }

    fn marked_content(mcid: i64) -> Operation {
        let mut properties = Dictionary::new();
        properties.set("MCID", mcid);
        Operation::new(
            "BDC",
            vec![
                Object::Name(b"Span".to_vec()),
                Object::Dictionary(properties),
            ],
        )
    }

    #[test]
    fn composes_text_position_with_the_graphics_transform() {
        let operations = vec![
            marked_content(0),
            Operation::new("q", vec![]),
            Operation::new("cm", numbers([1.0, 0.0, 0.0, -1.0, 56.0, 524.0])),
            Operation::new("BT", vec![]),
            Operation::new("Tm", numbers([1.0, 0.0, 0.0, -1.0, 0.0, 340.0])),
            Operation::new(
                "Tj",
                vec![Object::String(
                    b"text".to_vec(),
                    lopdf::StringFormat::Literal,
                )],
            ),
            Operation::new("ET", vec![]),
            Operation::new("Q", vec![]),
            Operation::new("EMC", vec![]),
        ];

        let markers = semantic_markers_from_operations(&operations, Some(&[Some(7)]));

        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].block_id, Some(7));
        assert!((markers[0].x - 56.0).abs() < 0.001);
        assert!((markers[0].y - 184.0).abs() < 0.001);
    }

    #[test]
    fn preserves_parent_semantics_through_unmapped_nested_content() {
        let operations = vec![
            marked_content(0),
            Operation::new("BMC", vec![Object::Name(b"Span".to_vec())]),
            Operation::new("BT", vec![]),
            Operation::new("Tm", numbers([1.0, 0.0, 0.0, 1.0, 20.0, 30.0])),
            Operation::new(
                "Tj",
                vec![Object::String(
                    b"text".to_vec(),
                    lopdf::StringFormat::Literal,
                )],
            ),
            Operation::new("EMC", vec![]),
            Operation::new("EMC", vec![]),
        ];

        let markers = semantic_markers_from_operations(&operations, Some(&[Some(9)]));

        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].block_id, Some(9));
    }

    #[test]
    fn emits_artifacts_without_assigning_a_semantic_block() {
        let operations = vec![
            Operation::new("BMC", vec![Object::Name(b"Artifact".to_vec())]),
            Operation::new("BT", vec![]),
            Operation::new("Tm", numbers([1.0, 0.0, 0.0, 1.0, 5.0, 6.0])),
            Operation::new(
                "Tj",
                vec![Object::String(
                    b"footer".to_vec(),
                    lopdf::StringFormat::Literal,
                )],
            ),
            Operation::new("EMC", vec![]),
        ];

        let markers = semantic_markers_from_operations(&operations, None);

        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].block_id, None);
        assert!((markers[0].x - 5.0).abs() < 0.001);
        assert!((markers[0].y - 6.0).abs() < 0.001);
    }

    #[test]
    fn concatenates_nested_graphics_transforms() {
        let transform = PdfTransform::IDENTITY
            .then(PdfTransform {
                a: 2.0,
                d: 2.0,
                e: 10.0,
                f: 20.0,
                ..PdfTransform::IDENTITY
            })
            .then(PdfTransform {
                e: 3.0,
                f: 4.0,
                ..PdfTransform::IDENTITY
            });

        assert_eq!(transform.apply(0.0, 0.0), (16.0, 28.0));
    }
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
