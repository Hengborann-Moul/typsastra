# v0.6.0 Draft Preview implementation plan

Draft Preview is an explicitly selected, workspace-specific preview mode for
image-heavy Typst documents. It reduces repeated image decoding during
authoring without changing the user's source files or weakening final PDF
output.

## Product contract

- **Normal Preview** compiles the document with its original images.
- **Draft Preview** replaces eligible image calls only inside Typsastra's
  private render mirror.
- The original `.typ` files and image files are never modified.
- PDF export always uses Normal Preview and the original images.
- The selected preview mode is stored in `.typsastra/workspace.json`.
- The last successful preview remains visible until the requested mode has
  compiled and loaded successfully.

Draft Preview is not a source-image optimizer. It never modifies, replaces, or
redistributes source images. Typsastra may create disposable low-resolution
hover thumbnails inside `.typsastra/cache`; these are private preview artifacts
and are never used for Normal Preview or PDF export.

## Ratio-preserving placeholders

For a statically resolvable local `image("path")` call, Typsastra reads only
enough image metadata to determine its intrinsic width and height. It replaces
the image in the private render mirror with a Typst `block` containing the
literal relative path as fixed-size `raw` text. This avoids embedding a
resolution-scaled label inside an SVG or raster placeholder.

This gives the placeholder the exact intrinsic aspect ratio of the source
image. Explicit `width` and `height` arguments are copied to the block. When
either dimension is absent, Typsastra supplies normalized point dimensions
derived from the intrinsic ratio instead of scaling the placeholder from source
pixel resolution. Image-only arguments such as `fit` are intentionally omitted.

Supported metadata readers initially cover PNG, JPEG, GIF, BMP, WebP VP8X, and
SVG with a usable `viewBox` or numeric width and height.

Typsastra leaves the original call unchanged when it cannot guarantee the
ratio, including:

- dynamic paths such as `image(path-variable)`;
- package or remote resources;
- missing or unreadable files;
- unsupported image formats or metadata;
- invalid intrinsic dimensions.

The Draft Preview details dialog reports these unresolved calls.

## Cached image inspection

Each generated placeholder is wrapped in a private opaque link. Hovering or
keyboard-focusing that placeholder in the PDF preview shows a bounded
low-resolution thumbnail. Every statically resolved included image receives a
thumbnail, including images below the large-image thresholds. Hover never
decodes or transfers the full-resolution source merely to display the bounded
inspection overlay.

The overlay contract is:

- accept only a generation manifest ID produced by Typsastra;
- reject paths outside the current project;
- load only the cache artifact associated with that manifest entry;
- show a lightweight `Preparing image preview…` state when its thumbnail is
  still pending;
- create at most one visible temporary object URL;
- revoke that URL when the overlay closes, the preview scrolls or zooms, or a
  new PDF generation is installed;
- never expose an unrestricted filesystem URL to the preview document.

An explicit **Open Original Image** action may open the source through the
operating system. The hover overlay is for identifying an image and checking
its composition, not for pixel-level inspection.

## Thumbnail generation and cache

### Coverage and output

The generation manifest contains each unique statically resolved local image
referenced by the compiled project. Multiple references to the same canonical
source share one thumbnail.

Generated thumbnails:

- preserve the source aspect ratio and composite transparency onto white for
  the disposable hover preview;
- start within a 640-pixel longest-edge budget without enlarging smaller source
  dimensions, then reduce further only when required by the byte budget;
- use adaptive JPEG encoding capped below 100 KiB per thumbnail rather than
  copying the original;
- are written atomically under
  `.typsastra/cache/draft-thumbnails/`;
- are excluded from Typsastra project archives, source ZIP exports, and PDF
  exports;
- may be discarded at any time and regenerated from the source.

The hover inspection card is capped at 340 by 300 CSS pixels, with the image
itself capped at 320 by 240 CSS pixels. It therefore remains a contextual
preview instead of filling the Draft pane.

The cache key includes:

```text
canonical source identity
source byte length
source modification timestamp
thumbnail transform/version identifier
```

This invalidates stale thumbnails without hashing every image during ordinary
Draft preparation. A future integrity-sensitive mode may add a content digest,
but it is not required for the initial cache.

### Fixed per-generation queue

Thumbnail scheduling begins only after the newly compiled Draft PDF and its
generation manifest have been presented. It must not delay project loading,
Draft source preparation, Typst compilation, or first-page display.

Typsastra creates one immutable queue for that preview generation. The queue is
based on the displayed page at presentation time and is not rebuilt when the
user scrolls, changes page, or hovers another placeholder.

The ordering is:

1. Images on the displayed page whose width or height is at least 1,000 pixels,
   or whose encoded source size is at least 1 MiB.
2. All other images on the displayed page, preserving their annotation order.
3. Every remaining included image, ordered from largest to smallest by
   estimated decoded size (`width × height × 4`), then encoded source size,
   then document order.

For example, when the displayed page contains five images and two exceed the
threshold, Typsastra generates the two large thumbnails first, the other three
page thumbnails next, and then the rest of the document from largest to
smallest.

Hovering an uncached placeholder does not mutate or reprioritize the queue. It
shows the preparing state until that fixed queue reaches the image. This keeps
the scheduler deterministic and avoids hidden races between scroll, hover,
recompile, and cache writes.

### Recompile and concurrency

Only one thumbnail worker runs for a project:

- a recompile creates a replacement generation queue;
- the thumbnail already being generated may finish and commit atomically;
- remaining work from the retired queue is discarded;
- the replacement queue skips every valid cache hit;
- duplicate jobs for the same cache key are coalesced;
- closing or reloading the project stops pending work after the active
  operation reaches a safe boundary.

Thumbnail decoding and resampling run outside the WebView main thread.
Completed thumbnails are transferred to the WebView only when inspected.
The frontend may retain a small bounded LRU of recent thumbnail object URLs,
but generation-scoped manifests remain authoritative.

## Source synchronization

Generated wrappers are recorded in the private render source map. Unchanged
source remains mapped normally, while each linked block maps back to the
original image call. Hovering or keyboard-focusing a Draft placeholder inspects
its original image. Clicking the block, including its fixed-size path label, uses its
generation manifest to inverse-sync directly to the original source
`image(...)` call without asking Tinymist to resolve synthetic coordinates.

Normal Preview remains the reference mode for validating exact forward and
inverse synchronization.

## Lifecycle and failure handling

Preview mode, PDF bytes, source-map identity, image manifest, and diagnostics
belong to one render generation. They are committed together only after the new
PDF is successfully presented. A failed or stale generation cannot replace the
manifest used by the currently visible preview.

Switching modes cancels stale preparation, queues a forced refresh, and leaves
the last successful preview visible. Workspace loading restores the requested
mode before starting preview compilation.

## Measurements

Developer performance diagnostics record:

- `preview.draft-prepare`, including replaced and unresolved image counts;
- `preview.draft-thumbnail`, including cache hit/miss, queue class, source and
  output dimensions, source/output bytes, decode time, resize time, and encode
  time;
- `preview.draft-hover`, including thumbnail bytes, intrinsic dimensions,
  cache readiness, and time to visible overlay;
- the existing compile, PDF load, first-page, canvas, and memory metrics.

Qualification should compare Normal and Draft Preview with repeated on-type and
on-save updates across:

- many small raster images;
- several high-resolution images;
- mixed raster and SVG documents;
- repeated mode switching;
- compilation failures;
- workspace close/reopen;
- detached preview windows;
- final PDF export.

## Acceptance checklist

- [x] Normal and Draft controls are available in the live-preview toolbar.
- [x] The selected mode persists per workspace.
- [x] Static local image calls receive exact-ratio placeholders.
- [x] Explicit Typst width and height values transfer to linked placeholder blocks.
- [x] Dynamic or unsafe calls remain unchanged and are reported.
- [x] Placeholder hover/focus supports on-demand image inspection.
- [x] Draft placeholder clicks inverse-sync to their original image calls.
- [x] A render generation installs its mode and manifest atomically.
- [x] Final PDF export explicitly uses Normal Preview.
- [x] Rust and TypeScript tests cover parsing, ratios, routing, and migration.
- [x] All statically resolved included images receive disposable cached
  thumbnails.
- [x] Thumbnail generation starts only after Draft PDF presentation.
- [x] The fixed queue prioritizes large displayed-page images, remaining
  displayed-page images, then all other images from largest to smallest.
- [x] Scroll, page, and hover activity never rebuild or reprioritize an active
  generation queue.
- [x] Recompile retires pending old-generation work without creating competing
  workers.
- [x] Source changes invalidate cached thumbnails through source metadata and
  transform-version identity.
- [x] Hover transfers and decodes the cached thumbnail rather than the original
  full-resolution source.
- [x] Thumbnail artifacts never enter project, source ZIP, or PDF exports.
- [ ] Runtime qualification is complete on Windows, Linux, and macOS.
- [ ] Image-heavy benchmark results are published.
