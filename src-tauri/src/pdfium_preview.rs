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
    pub role: Option<String>,
    pub table_id: Option<u64>,
    pub row_id: Option<u64>,
    pub cell_id: Option<u64>,
    pub figure_id: Option<u64>,
    pub x: f32,
    pub y: f32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct PdfiumSemanticBlock {
    block_id: Option<u64>,
    role: Option<String>,
    table_id: Option<u64>,
    row_id: Option<u64>,
    cell_id: Option<u64>,
    figure_id: Option<u64>,
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
    font_families: HashMap<String, String>,
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
                    let (semantic_markers, font_families) = load_pdf_metadata(&path);
                    documents.insert(
                        document_id,
                        OpenPdfiumDocument {
                            document,
                            path,
                            delete_on_close,
                            semantic_markers,
                            font_families,
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
    let font_families = documents
        .get(&document_id)
        .map(|document| &document.font_families);
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
                font_family: resolved_font_family(&char.font_name(), font_families),
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

fn resolved_font_family(pdfium_name: &str, families: Option<&HashMap<String, String>>) -> String {
    let normalized = normalized_pdf_font_name(pdfium_name);
    families
        .and_then(|families| families.get(&normalized))
        .cloned()
        .unwrap_or(normalized)
}

fn normalized_pdf_font_name(value: &str) -> String {
    let without_subset = value
        .split_once('+')
        .filter(|(prefix, _)| prefix.len() == 6 && prefix.chars().all(|c| c.is_ascii_uppercase()))
        .map(|(_, family)| family)
        .unwrap_or(value);
    without_subset.trim_start_matches('/').trim().to_string()
}

fn load_embedded_font_families(document: &lopdf::Document) -> HashMap<String, String> {
    let mut families = HashMap::new();
    for object in document.objects.values() {
        let Some(dictionary) = resolved_dictionary(document, object) else {
            continue;
        };
        let Ok(base_font) = dictionary.get(b"BaseFont") else {
            continue;
        };
        let Some(base_font) = pdf_name_or_string(base_font) else {
            continue;
        };
        let descriptor = font_descriptor(document, dictionary);
        let family = descriptor
            .and_then(|descriptor| descriptor.get(b"FontFamily").ok())
            .and_then(pdf_name_or_string)
            .or_else(|| {
                descriptor.and_then(|descriptor| embedded_font_family(document, descriptor))
            });
        if let Some(family) = family.filter(|family| !family.trim().is_empty()) {
            families.insert(normalized_pdf_font_name(&base_font), family);
        }
    }
    families
}

fn resolved_object<'a>(
    document: &'a lopdf::Document,
    object: &'a lopdf::Object,
) -> Option<&'a lopdf::Object> {
    match object {
        lopdf::Object::Reference(id) => document.get_object(*id).ok(),
        object => Some(object),
    }
}

fn resolved_dictionary<'a>(
    document: &'a lopdf::Document,
    object: &'a lopdf::Object,
) -> Option<&'a lopdf::Dictionary> {
    match resolved_object(document, object)? {
        lopdf::Object::Dictionary(dictionary) => Some(dictionary),
        lopdf::Object::Stream(stream) => Some(&stream.dict),
        _ => None,
    }
}

fn font_descriptor<'a>(
    document: &'a lopdf::Document,
    font: &'a lopdf::Dictionary,
) -> Option<&'a lopdf::Dictionary> {
    if let Ok(descriptor) = font.get(b"FontDescriptor") {
        return resolved_dictionary(document, descriptor);
    }
    let descendants = resolved_object(document, font.get(b"DescendantFonts").ok()?)
        .and_then(|object| object.as_array().ok())?;
    let descendant = resolved_dictionary(document, descendants.first()?)?;
    resolved_dictionary(document, descendant.get(b"FontDescriptor").ok()?)
}

fn embedded_font_family(
    document: &lopdf::Document,
    descriptor: &lopdf::Dictionary,
) -> Option<String> {
    let stream = [b"FontFile".as_slice(), b"FontFile2", b"FontFile3"]
        .into_iter()
        .find_map(|key| descriptor.get(key).ok())
        .and_then(|object| resolved_object(document, object))
        .and_then(|object| object.as_stream().ok())?;
    let bytes = stream.decompressed_content().ok()?;
    let face = ttf_parser::Face::parse(&bytes, 0).ok()?;
    for name_id in [
        ttf_parser::name_id::TYPOGRAPHIC_FAMILY,
        ttf_parser::name_id::FAMILY,
    ] {
        if let Some(family) = face
            .names()
            .into_iter()
            .find(|name| name.name_id == name_id)
            .and_then(|name| name.to_string())
            .filter(|family| !family.trim().is_empty())
        {
            return Some(family);
        }
    }
    None
}

fn pdf_name_or_string(object: &lopdf::Object) -> Option<String> {
    match object {
        lopdf::Object::Name(value) | lopdf::Object::String(value, _) => {
            Some(String::from_utf8_lossy(value).into_owned())
        }
        _ => None,
    }
}

fn load_pdf_metadata(
    path: &std::path::Path,
) -> (
    HashMap<u16, Vec<PdfiumSemanticMarker>>,
    HashMap<String, String>,
) {
    let Ok(document) = lopdf::Document::load(path) else {
        return (HashMap::new(), HashMap::new());
    };
    (
        load_semantic_markers_from_document(&document).unwrap_or_default(),
        load_embedded_font_families(&document),
    )
}

fn load_semantic_markers_from_document(
    document: &lopdf::Document,
) -> Result<HashMap<u16, Vec<PdfiumSemanticMarker>>, String> {
    let semantic_blocks = load_semantic_blocks_from_document(document)?;
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

#[derive(Clone, Debug, PartialEq, Eq)]
enum MarkedContentKind {
    Semantic(PdfiumSemanticBlock),
    Artifact,
    Unmapped,
}

#[derive(Clone, Debug)]
struct MarkedContentState {
    kind: MarkedContentKind,
    marker_emitted: bool,
}

fn semantic_markers_from_operations(
    operations: &[lopdf::content::Operation],
    blocks: Option<&[Option<PdfiumSemanticBlock>]>,
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
                let block = mcid.and_then(|mcid| {
                    usize::try_from(mcid)
                        .ok()
                        .and_then(|index| blocks.and_then(|blocks| blocks.get(index)))
                        .cloned()
                        .flatten()
                });
                let kind = if artifact {
                    MarkedContentKind::Artifact
                } else if let Some(block) = block {
                    MarkedContentKind::Semantic(block)
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
                let block = match &marked_content[index].kind {
                    MarkedContentKind::Semantic(block) => block.clone(),
                    MarkedContentKind::Artifact => PdfiumSemanticBlock::default(),
                    MarkedContentKind::Unmapped => unreachable!(),
                };
                markers.push(PdfiumSemanticMarker {
                    block_id: block.block_id,
                    role: block.role,
                    table_id: block.table_id,
                    row_id: block.row_id,
                    cell_id: block.cell_id,
                    figure_id: block.figure_id,
                    x,
                    y,
                });
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
) -> Result<HashMap<u16, Vec<Option<PdfiumSemanticBlock>>>, String> {
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

    let mut blocks = HashMap::<u16, BTreeMap<i64, PdfiumSemanticBlock>>::new();
    let mut next_id = 1_u64;
    visit_structure_object(
        &document,
        &pages,
        root,
        None,
        PdfiumSemanticBlock::default(),
        &mut next_id,
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
            for (mcid, block) in mcids {
                if let Ok(index) = usize::try_from(mcid) {
                    ordered[index] = Some(block);
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
    inherited: PdfiumSemanticBlock,
    next_id: &mut u64,
    blocks: &mut HashMap<u16, BTreeMap<i64, PdfiumSemanticBlock>>,
) {
    use lopdf::Object;

    let resolved = match object {
        Object::Reference(object_id) => document.get_object(object_id).ok().cloned(),
        object => Some(object),
    };
    let Some(resolved) = resolved else { return };
    match resolved {
        Object::Integer(mcid) => {
            if let Some(page_no) = inherited_page {
                if inherited.block_id.is_some() || inherited.role.is_some() {
                    blocks.entry(page_no).or_default().insert(mcid, inherited);
                }
            }
        }
        Object::Array(children) => {
            for child in children {
                visit_structure_object(
                    document,
                    pages,
                    child,
                    inherited_page,
                    inherited.clone(),
                    next_id,
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
            let mut current = semantic_child_context(kind, inherited, next_id);
            if kind == b"Div" && structure_has_immediate_role(document, &dictionary, b"Caption") {
                let id = *next_id;
                *next_id += 1;
                current.figure_id = Some(id);
                current.block_id = Some(id);
                current.role = Some("Figure".to_string());
            }

            if let Ok(mcid) = dictionary.get(b"MCID").and_then(Object::as_i64) {
                if let Some(page_no) = page_no {
                    if current.block_id.is_some() || current.role.is_some() {
                        blocks
                            .entry(page_no)
                            .or_default()
                            .insert(mcid, current.clone());
                    }
                }
            }
            if let Ok(children) = dictionary.get(b"K") {
                visit_structure_object(
                    document,
                    pages,
                    children.clone(),
                    page_no,
                    current,
                    next_id,
                    blocks,
                );
            }
        }
        Object::Stream(stream) => visit_structure_object(
            document,
            pages,
            Object::Dictionary(stream.dict),
            inherited_page,
            inherited,
            next_id,
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

fn semantic_child_context(
    kind: &[u8],
    mut context: PdfiumSemanticBlock,
    next_id: &mut u64,
) -> PdfiumSemanticBlock {
    let role = String::from_utf8_lossy(kind).into_owned();
    let allocate = |next_id: &mut u64| {
        let id = *next_id;
        *next_id += 1;
        id
    };
    match kind {
        b"Table" => {
            context.table_id = Some(allocate(next_id));
            context.row_id = None;
            context.cell_id = None;
            context.role = Some(role);
        }
        b"TR" => {
            context.row_id = Some(allocate(next_id));
            context.cell_id = None;
            context.role = Some(role);
        }
        b"TH" | b"TD" => {
            let id = allocate(next_id);
            context.cell_id = Some(id);
            context.block_id = Some(id);
            context.role = Some(role);
        }
        b"Figure" => {
            let id = allocate(next_id);
            context.figure_id = Some(id);
            context.block_id = Some(id);
            context.role = Some(role);
        }
        _ if is_semantic_text_block(kind) => {
            context.block_id = Some(allocate(next_id));
            context.role = Some(role);
        }
        _ => {}
    }
    context
}

fn structure_has_immediate_role(
    document: &lopdf::Document,
    dictionary: &lopdf::Dictionary,
    expected: &[u8],
) -> bool {
    fn matches(document: &lopdf::Document, object: &lopdf::Object, expected: &[u8]) -> bool {
        match resolved_object(document, object) {
            Some(lopdf::Object::Array(children)) => children
                .iter()
                .any(|child| matches(document, child, expected)),
            Some(lopdf::Object::Dictionary(child)) => child
                .get(b"S")
                .ok()
                .and_then(|role| role.as_name().ok())
                .is_some_and(|role| role == expected),
            Some(lopdf::Object::Stream(stream)) => stream
                .dict
                .get(b"S")
                .ok()
                .and_then(|role| role.as_name().ok())
                .is_some_and(|role| role == expected),
            _ => false,
        }
    }
    dictionary
        .get(b"K")
        .ok()
        .is_some_and(|children| matches(document, children, expected))
}

#[cfg(test)]
mod semantic_marker_tests {
    use super::{semantic_markers_from_operations, PdfTransform, PdfiumSemanticBlock};
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

    fn block(id: u64) -> PdfiumSemanticBlock {
        PdfiumSemanticBlock {
            block_id: Some(id),
            role: Some("P".to_string()),
            ..PdfiumSemanticBlock::default()
        }
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

        let markers = semantic_markers_from_operations(&operations, Some(&[Some(block(7))]));

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

        let markers = semantic_markers_from_operations(&operations, Some(&[Some(block(9))]));

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
