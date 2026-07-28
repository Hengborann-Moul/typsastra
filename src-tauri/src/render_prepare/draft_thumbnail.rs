use super::draft::DraftImageAsset;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ExtendedColorType, GenericImageView, ImageReader, Rgb, RgbImage};
use resvg::{tiny_skia, usvg};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const THUMBNAIL_LONGEST_EDGE: u32 = 640;
const THUMBNAIL_TARGET_BYTES: usize = 96 * 1024;
const THUMBNAIL_TRANSFORM_VERSION: &str = "draft-thumbnail-v2-jpeg-640-96k";
const LARGE_SOURCE_BYTES: u64 = 1024 * 1024;
const LARGE_DIMENSION: u32 = 1000;

static THUMBNAIL_EPOCH: AtomicU64 = AtomicU64::new(0);
static THUMBNAIL_WORKER_LOCK: Mutex<()> = Mutex::new(());
static THUMBNAIL_STATE: LazyLock<Mutex<ThumbnailState>> =
    LazyLock::new(|| Mutex::new(ThumbnailState::default()));

#[derive(Default)]
struct ThumbnailState {
    generation: u64,
    workspace_root: PathBuf,
    entries: HashMap<String, ThumbnailEntry>,
}

#[derive(Clone)]
struct ThumbnailEntry {
    cache_path: PathBuf,
    source_path: PathBuf,
    status: ThumbnailStatus,
    mime_type: String,
    width: u32,
    height: u32,
    source_bytes: u64,
    queue_class: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ThumbnailStatus {
    Pending,
    Generating,
    Ready,
    Failed,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDraftThumbnailRequest {
    pub generation: u64,
    pub workspace_root: String,
    pub assets: Vec<DraftImageAsset>,
    pub displayed_page_asset_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftThumbnailQueueSummary {
    pub generation: u64,
    pub cache_hits: usize,
    pub queued: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftThumbnailStatus {
    pub status: String,
    pub path: Option<String>,
    pub mime_type: Option<String>,
    pub width: u32,
    pub height: u32,
    pub source_bytes: u64,
    pub output_bytes: Option<u64>,
    pub queue_class: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftThumbnailMetric {
    pub generation: u64,
    pub id: String,
    pub cache_hit: bool,
    pub queue_class: String,
    pub source_width: u32,
    pub source_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub source_bytes: u64,
    pub output_bytes: u64,
    pub decode_ms: f64,
    pub resize_ms: f64,
    pub encode_ms: f64,
    pub total_ms: f64,
    pub failed: bool,
}

#[derive(Clone)]
struct ThumbnailJob {
    id: String,
    entry: ThumbnailEntry,
}

struct GeneratedThumbnail {
    output_width: u32,
    output_height: u32,
    output_bytes: u64,
    decode_ms: f64,
    resize_ms: f64,
    encode_ms: f64,
}

#[tauri::command]
pub async fn start_draft_thumbnail_generation(
    app: AppHandle,
    request: StartDraftThumbnailRequest,
) -> Result<DraftThumbnailQueueSummary, String> {
    let workspace_root = canonical_path(Path::new(&request.workspace_root))
        .ok_or_else(|| "The thumbnail workspace root is unavailable.".to_string())?;
    let cache_root = workspace_root
        .join(".typsastra")
        .join("cache")
        .join("draft-thumbnails");
    fs::create_dir_all(&cache_root)
        .map_err(|error| format!("Could not create the Draft thumbnail cache: {error}"))?;
    let epoch = THUMBNAIL_EPOCH.fetch_add(1, Ordering::AcqRel) + 1;
    let displayed_order = request
        .displayed_page_asset_ids
        .iter()
        .enumerate()
        .map(|(index, id)| (id.clone(), index))
        .collect::<HashMap<_, _>>();
    let displayed = displayed_order.keys().cloned().collect::<HashSet<_>>();

    let indexed = ordered_assets(request.assets, &displayed_order);

    let mut entries = HashMap::new();
    let mut jobs = Vec::new();
    let mut cache_hits = 0;
    for (_, asset) in indexed {
        let source_path = canonical_path(&asset.path)
            .ok_or_else(|| format!("Draft image is unavailable: {}", asset.path.display()))?;
        if !source_path.starts_with(&workspace_root) {
            return Err("A Draft thumbnail source resolves outside the active workspace.".into());
        }
        let metadata = fs::metadata(&source_path)
            .map_err(|error| format!("Could not inspect Draft image metadata: {error}"))?;
        let cache_key = thumbnail_cache_key(&source_path, &metadata)?;
        let cache_path = cache_root.join(format!("{cache_key}.jpg"));
        let ready = fs::metadata(&cache_path)
            .map(|metadata| metadata.is_file() && metadata.len() > 0)
            .unwrap_or(false);
        let queue_class = if displayed.contains(&asset.id) && is_large(&asset) {
            "displayed-large"
        } else if displayed.contains(&asset.id) {
            "displayed"
        } else {
            "remaining"
        }
        .to_string();
        let entry = ThumbnailEntry {
            cache_path,
            source_path,
            status: if ready {
                ThumbnailStatus::Ready
            } else {
                ThumbnailStatus::Pending
            },
            mime_type: "image/jpeg".into(),
            width: asset.width,
            height: asset.height,
            source_bytes: asset.source_bytes,
            queue_class,
        };
        if ready {
            cache_hits += 1;
            let (output_width, output_height) = image::image_dimensions(&entry.cache_path)
                .unwrap_or_else(|_| thumbnail_dimensions(asset.width, asset.height));
            let output_bytes = fs::metadata(&entry.cache_path)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            emit_thumbnail_metric(
                &app,
                DraftThumbnailMetric {
                    generation: request.generation,
                    id: asset.id.clone(),
                    cache_hit: true,
                    queue_class: entry.queue_class.clone(),
                    source_width: asset.width,
                    source_height: asset.height,
                    output_width,
                    output_height,
                    source_bytes: asset.source_bytes,
                    output_bytes,
                    decode_ms: 0.0,
                    resize_ms: 0.0,
                    encode_ms: 0.0,
                    total_ms: 0.0,
                    failed: false,
                },
            );
        } else {
            jobs.push(ThumbnailJob {
                id: asset.id.clone(),
                entry: entry.clone(),
            });
        }
        entries.insert(asset.id, entry);
    }
    let retained_paths = entries
        .values()
        .map(|entry| entry.cache_path.clone())
        .collect::<HashSet<_>>();
    {
        let mut state = THUMBNAIL_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *state = ThumbnailState {
            generation: request.generation,
            workspace_root,
            entries,
        };
    }
    let queued = jobs.len();
    tauri::async_runtime::spawn_blocking(move || {
        run_thumbnail_queue(
            &app,
            epoch,
            request.generation,
            &cache_root,
            &retained_paths,
            jobs,
        )
    });
    Ok(DraftThumbnailQueueSummary {
        generation: request.generation,
        cache_hits,
        queued,
    })
}

fn ordered_assets(
    assets: Vec<DraftImageAsset>,
    displayed_order: &HashMap<String, usize>,
) -> Vec<(usize, DraftImageAsset)> {
    let displayed = displayed_order.keys().collect::<HashSet<_>>();
    let mut indexed = assets.into_iter().enumerate().collect::<Vec<_>>();
    indexed.sort_by(|(left_index, left), (right_index, right)| {
        let left_displayed = displayed.contains(&left.id);
        let right_displayed = displayed.contains(&right.id);
        let left_large = is_large(left);
        let right_large = is_large(right);
        let left_class = if left_displayed && left_large {
            0
        } else if left_displayed {
            1
        } else {
            2
        };
        let right_class = if right_displayed && right_large {
            0
        } else if right_displayed {
            1
        } else {
            2
        };
        left_class.cmp(&right_class).then_with(|| {
            if left_class < 2 {
                displayed_order
                    .get(&left.id)
                    .unwrap_or(left_index)
                    .cmp(displayed_order.get(&right.id).unwrap_or(right_index))
            } else {
                right
                    .estimated_decoded_bytes
                    .cmp(&left.estimated_decoded_bytes)
                    .then_with(|| right.source_bytes.cmp(&left.source_bytes))
                    .then_with(|| left_index.cmp(right_index))
            }
        })
    });
    indexed
}

#[tauri::command]
pub fn get_draft_thumbnail_status(
    generation: u64,
    workspace_root: String,
    id: String,
) -> Result<DraftThumbnailStatus, String> {
    let requested_root = canonical_path(Path::new(&workspace_root))
        .ok_or_else(|| "The thumbnail workspace root is unavailable.".to_string())?;
    let state = THUMBNAIL_STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if state.generation != generation || state.workspace_root != requested_root {
        return Err("The Draft thumbnail generation is no longer active.".into());
    }
    let entry = state
        .entries
        .get(&id)
        .ok_or_else(|| "The Draft thumbnail is not part of the active manifest.".to_string())?;
    let ready = entry.status == ThumbnailStatus::Ready;
    Ok(DraftThumbnailStatus {
        status: match entry.status {
            ThumbnailStatus::Pending => "pending",
            ThumbnailStatus::Generating => "generating",
            ThumbnailStatus::Ready => "ready",
            ThumbnailStatus::Failed => "failed",
        }
        .into(),
        path: ready.then(|| entry.cache_path.to_string_lossy().to_string()),
        mime_type: ready.then(|| entry.mime_type.clone()),
        width: entry.width,
        height: entry.height,
        source_bytes: entry.source_bytes,
        output_bytes: ready
            .then(|| {
                fs::metadata(&entry.cache_path)
                    .ok()
                    .map(|metadata| metadata.len())
            })
            .flatten(),
        queue_class: entry.queue_class.clone(),
    })
}

#[tauri::command]
pub fn cancel_draft_thumbnail_generation() {
    THUMBNAIL_EPOCH.fetch_add(1, Ordering::AcqRel);
    let mut state = THUMBNAIL_STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *state = ThumbnailState::default();
}

fn run_thumbnail_queue(
    app: &AppHandle,
    epoch: u64,
    generation: u64,
    cache_root: &Path,
    retained_paths: &HashSet<PathBuf>,
    jobs: Vec<ThumbnailJob>,
) {
    let _worker = THUMBNAIL_WORKER_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    remove_stale_cache_entries(cache_root, retained_paths);
    for job in jobs {
        if THUMBNAIL_EPOCH.load(Ordering::Acquire) != epoch {
            break;
        }
        update_status(generation, &job.id, ThumbnailStatus::Generating);
        let started = Instant::now();
        let result = generate_thumbnail(&job.entry.source_path, &job.entry.cache_path);
        let status = if result.is_ok() {
            ThumbnailStatus::Ready
        } else {
            ThumbnailStatus::Failed
        };
        update_status(generation, &job.id, status);
        let total_ms = duration_ms(started);
        let metric = match result {
            Ok(result) => DraftThumbnailMetric {
                generation,
                id: job.id,
                cache_hit: false,
                queue_class: job.entry.queue_class,
                source_width: job.entry.width,
                source_height: job.entry.height,
                output_width: result.output_width,
                output_height: result.output_height,
                source_bytes: job.entry.source_bytes,
                output_bytes: result.output_bytes,
                decode_ms: result.decode_ms,
                resize_ms: result.resize_ms,
                encode_ms: result.encode_ms,
                total_ms,
                failed: false,
            },
            Err(_) => DraftThumbnailMetric {
                generation,
                id: job.id,
                cache_hit: false,
                queue_class: job.entry.queue_class,
                source_width: job.entry.width,
                source_height: job.entry.height,
                output_width: 0,
                output_height: 0,
                source_bytes: job.entry.source_bytes,
                output_bytes: 0,
                decode_ms: 0.0,
                resize_ms: 0.0,
                encode_ms: 0.0,
                total_ms,
                failed: true,
            },
        };
        emit_thumbnail_metric(app, metric);
    }
}

fn remove_stale_cache_entries(cache_root: &Path, retained_paths: &HashSet<PathBuf>) {
    let Ok(entries) = fs::read_dir(cache_root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && !retained_paths.contains(&path) {
            let _ = fs::remove_file(path);
        }
    }
}

fn update_status(generation: u64, id: &str, status: ThumbnailStatus) {
    let mut state = THUMBNAIL_STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if state.generation == generation {
        if let Some(entry) = state.entries.get_mut(id) {
            entry.status = status;
        }
    }
}

fn generate_thumbnail(source: &Path, destination: &Path) -> Result<GeneratedThumbnail, String> {
    if destination.is_file() {
        let image = ImageReader::open(destination)
            .map_err(|error| format!("Could not open cached thumbnail: {error}"))?
            .with_guessed_format()
            .map_err(|error| format!("Could not identify cached thumbnail: {error}"))?
            .decode()
            .map_err(|error| format!("Could not decode cached thumbnail: {error}"))?;
        let (output_width, output_height) = image.dimensions();
        return Ok(GeneratedThumbnail {
            output_width,
            output_height,
            output_bytes: fs::metadata(destination)
                .map(|metadata| metadata.len())
                .unwrap_or(0),
            decode_ms: 0.0,
            resize_ms: 0.0,
            encode_ms: 0.0,
        });
    }
    let decode_started = Instant::now();
    let image = if source
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("svg"))
    {
        render_svg(source)?
    } else {
        ImageReader::open(source)
            .map_err(|error| format!("Could not open image: {error}"))?
            .with_guessed_format()
            .map_err(|error| format!("Could not identify image format: {error}"))?
            .decode()
            .map_err(|error| format!("Could not decode image: {error}"))?
    };
    let decode_ms = duration_ms(decode_started);
    let resize_started = Instant::now();
    let (width, height) = image.dimensions();
    let thumbnail = if width <= THUMBNAIL_LONGEST_EDGE && height <= THUMBNAIL_LONGEST_EDGE {
        image
    } else {
        let (output_width, output_height) =
            scaled_dimensions(width, height, THUMBNAIL_LONGEST_EDGE);
        image.resize_exact(output_width, output_height, FilterType::Triangle)
    };
    let initial_resize_ms = duration_ms(resize_started);
    let encode_started = Instant::now();
    let (encoded, output_width, output_height, adaptive_resize_ms) =
        encode_bounded_jpeg(thumbnail)?;
    let encode_ms = (duration_ms(encode_started) - adaptive_resize_ms).max(0.0);
    let resize_ms = initial_resize_ms + adaptive_resize_ms;
    let temporary = destination.with_extension(format!(
        "jpg.tmp-{}-{}",
        std::process::id(),
        THUMBNAIL_EPOCH.load(Ordering::Acquire)
    ));
    fs::write(&temporary, &encoded)
        .map_err(|error| format!("Could not write thumbnail: {error}"))?;
    if destination.is_file() {
        let _ = fs::remove_file(&temporary);
        return Ok(GeneratedThumbnail {
            output_width,
            output_height,
            output_bytes: fs::metadata(destination)
                .map(|metadata| metadata.len())
                .unwrap_or(0),
            decode_ms,
            resize_ms,
            encode_ms,
        });
    }
    fs::rename(&temporary, destination)
        .map_err(|error| format!("Could not commit thumbnail atomically: {error}"))?;
    Ok(GeneratedThumbnail {
        output_width,
        output_height,
        output_bytes: fs::metadata(destination)
            .map(|metadata| metadata.len())
            .unwrap_or(0),
        decode_ms,
        resize_ms,
        encode_ms,
    })
}

fn render_svg(path: &Path) -> Result<DynamicImage, String> {
    let data = fs::read(path).map_err(|error| format!("Could not read SVG: {error}"))?;
    let options = usvg::Options::default();
    let tree = usvg::Tree::from_data(&data, &options)
        .map_err(|error| format!("Could not parse SVG: {error}"))?;
    let size = tree.size();
    let longest = size.width().max(size.height());
    let scale = (THUMBNAIL_LONGEST_EDGE as f32 / longest).min(1.0);
    let width = (size.width() * scale).round().max(1.0) as u32;
    let height = (size.height() * scale).round().max(1.0) as u32;
    let mut pixmap = tiny_skia::Pixmap::new(width, height)
        .ok_or_else(|| "Could not allocate an SVG thumbnail surface.".to_string())?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    Ok(DynamicImage::ImageRgba8(
        image::RgbaImage::from_raw(width, height, pixmap.take())
            .ok_or_else(|| "Could not convert the SVG thumbnail surface.".to_string())?,
    ))
}

fn is_large(asset: &DraftImageAsset) -> bool {
    asset.width >= LARGE_DIMENSION
        || asset.height >= LARGE_DIMENSION
        || asset.source_bytes >= LARGE_SOURCE_BYTES
}

fn thumbnail_dimensions(width: u32, height: u32) -> (u32, u32) {
    if width <= THUMBNAIL_LONGEST_EDGE && height <= THUMBNAIL_LONGEST_EDGE {
        return (width, height);
    }
    scaled_dimensions(width, height, THUMBNAIL_LONGEST_EDGE)
}

fn scaled_dimensions(width: u32, height: u32, longest_edge: u32) -> (u32, u32) {
    let scale = longest_edge as f64 / f64::from(width.max(height));
    (
        (f64::from(width) * scale).round().max(1.0) as u32,
        (f64::from(height) * scale).round().max(1.0) as u32,
    )
}

fn encode_bounded_jpeg(image: DynamicImage) -> Result<(Vec<u8>, u32, u32, f64), String> {
    let mut rgb = flatten_to_rgb(image);
    let mut adaptive_resize_ms = 0.0;
    let mut quality = 68u8;
    loop {
        let (width, height) = rgb.dimensions();
        let mut encoded = Vec::new();
        JpegEncoder::new_with_quality(&mut encoded, quality)
            .encode(&rgb, width, height, ExtendedColorType::Rgb8)
            .map_err(|error| format!("Could not encode thumbnail: {error}"))?;
        if encoded.len() <= THUMBNAIL_TARGET_BYTES {
            return Ok((encoded, width, height, adaptive_resize_ms));
        }
        if width.max(height) <= 1 {
            return Err("Could not satisfy the Draft thumbnail byte budget.".into());
        }
        let resize_started = Instant::now();
        let current_edge = width.max(height);
        let next_edge = ((current_edge as f64 * 0.78).round() as u32)
            .min(current_edge - 1)
            .max(1);
        let (next_width, next_height) = scaled_dimensions(width, height, next_edge);
        rgb = image::imageops::resize(&rgb, next_width, next_height, FilterType::Triangle);
        adaptive_resize_ms += duration_ms(resize_started);
        quality = quality.saturating_sub(8).max(36);
    }
}

fn flatten_to_rgb(image: DynamicImage) -> RgbImage {
    if !image.color().has_alpha() {
        return image.to_rgb8();
    }
    let rgba = image.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let pixel = rgba.get_pixel(x, y).0;
        let alpha = u16::from(pixel[3]);
        let blend =
            |channel: u8| ((u16::from(channel) * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
        Rgb([blend(pixel[0]), blend(pixel[1]), blend(pixel[2])])
    })
}

fn duration_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}

fn emit_thumbnail_metric(app: &AppHandle, metric: DraftThumbnailMetric) {
    let _ = app.emit("draft-thumbnail-metric", metric);
}

fn thumbnail_cache_key(path: &Path, metadata: &fs::Metadata) -> Result<String, String> {
    let modified = metadata
        .modified()
        .map_err(|error| format!("Could not read the image modification time: {error}"))?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Image modification time is invalid: {error}"))?
        .as_nanos();
    let mut digest = Sha256::new();
    digest.update(path.to_string_lossy().as_bytes());
    digest.update(metadata.len().to_le_bytes());
    digest.update(modified.to_le_bytes());
    digest.update(THUMBNAIL_TRANSFORM_VERSION.as_bytes());
    Ok(format!("{:x}", digest.finalize()))
}

fn canonical_path(path: &Path) -> Option<PathBuf> {
    fs::canonicalize(path).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageFormat;
    fn asset(
        id: &str,
        width: u32,
        height: u32,
        source_bytes: u64,
        decoded_bytes: u64,
    ) -> DraftImageAsset {
        DraftImageAsset {
            id: id.into(),
            path: PathBuf::from(format!("{id}.png")),
            mime_type: "image/png".into(),
            width,
            height,
            source_bytes,
            estimated_decoded_bytes: decoded_bytes,
            references: Vec::new(),
        }
    }

    #[test]
    fn builds_one_immutable_queue_in_required_priority_order() {
        let assets = vec![
            asset("remaining-small", 100, 100, 10, 40_000),
            asset("displayed-small-b", 500, 500, 20, 1_000_000),
            asset("remaining-largest", 900, 900, 30, 4_000_000),
            asset("displayed-large-b", 1200, 700, 40, 3_360_000),
            asset("displayed-small-a", 400, 400, 50, 640_000),
            asset("displayed-large-a", 800, 800, LARGE_SOURCE_BYTES, 2_560_000),
            asset("remaining-medium", 700, 700, 60, 1_960_000),
        ];
        let displayed = [
            ("displayed-small-a".to_string(), 0),
            ("displayed-large-a".to_string(), 1),
            ("displayed-small-b".to_string(), 2),
            ("displayed-large-b".to_string(), 3),
        ]
        .into_iter()
        .collect::<HashMap<_, _>>();

        let ordered = ordered_assets(assets, &displayed)
            .into_iter()
            .map(|(_, asset)| asset.id)
            .collect::<Vec<_>>();

        assert_eq!(
            ordered,
            [
                "displayed-large-a",
                "displayed-large-b",
                "displayed-small-a",
                "displayed-small-b",
                "remaining-largest",
                "remaining-medium",
                "remaining-small",
            ]
        );
    }

    #[test]
    fn generates_a_ratio_preserving_thumbnail_without_upscaling() {
        let workspace = tempfile::tempdir().unwrap();
        let large_source = workspace.path().join("large.png");
        let large_destination = workspace.path().join("large-thumbnail.jpg");
        let detailed = RgbImage::from_fn(1600, 900, |x, y| {
            Rgb([
                ((x * 31 + y * 17) % 256) as u8,
                ((x * 7 + y * 43) % 256) as u8,
                ((x * 53 + y * 3) % 256) as u8,
            ])
        });
        DynamicImage::ImageRgb8(detailed)
            .save_with_format(&large_source, ImageFormat::Png)
            .unwrap();

        generate_thumbnail(&large_source, &large_destination).unwrap();
        let large_thumbnail = ImageReader::open(&large_destination)
            .unwrap()
            .decode()
            .unwrap();
        assert!(large_thumbnail.width() <= THUMBNAIL_LONGEST_EDGE);
        assert!(large_thumbnail.height() <= THUMBNAIL_LONGEST_EDGE);
        let source_ratio = 1600.0 / 900.0;
        let thumbnail_ratio =
            f64::from(large_thumbnail.width()) / f64::from(large_thumbnail.height());
        assert!((source_ratio - thumbnail_ratio).abs() < 0.01);
        assert!(fs::metadata(&large_destination).unwrap().len() < 100 * 1024);

        let small_source = workspace.path().join("small.png");
        let small_destination = workspace.path().join("small-thumbnail.jpg");
        DynamicImage::new_rgba8(320, 180)
            .save_with_format(&small_source, ImageFormat::Png)
            .unwrap();

        generate_thumbnail(&small_source, &small_destination).unwrap();
        let small_thumbnail = ImageReader::open(&small_destination)
            .unwrap()
            .decode()
            .unwrap();
        assert_eq!(small_thumbnail.dimensions(), (320, 180));
    }

    #[test]
    fn removes_obsolete_thumbnail_versions_and_stale_sources() {
        let workspace = tempfile::tempdir().unwrap();
        let retained = workspace.path().join("current.jpg");
        let old_png = workspace.path().join("old.png");
        let stale_jpeg = workspace.path().join("stale.jpg");
        fs::write(&retained, b"current").unwrap();
        fs::write(&old_png, b"old").unwrap();
        fs::write(&stale_jpeg, b"stale").unwrap();

        remove_stale_cache_entries(workspace.path(), &[retained.clone()].into_iter().collect());

        assert!(retained.is_file());
        assert!(!old_png.exists());
        assert!(!stale_jpeg.exists());
    }

    #[test]
    fn cache_key_changes_when_source_metadata_changes() {
        let workspace = tempfile::tempdir().unwrap();
        let source = workspace.path().join("source.png");
        fs::write(&source, b"first").unwrap();
        let first_metadata = fs::metadata(&source).unwrap();
        let first = thumbnail_cache_key(&source, &first_metadata).unwrap();

        fs::write(&source, b"second-and-longer").unwrap();
        let second_metadata = fs::metadata(&source).unwrap();
        let second = thumbnail_cache_key(&source, &second_metadata).unwrap();

        assert_ne!(first, second);
    }
}
