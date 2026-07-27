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

Draft Preview is not an image optimizer. It does not resize, recompress, copy,
or redistribute source images.

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

## On-demand image inspection

Each generated placeholder is wrapped in a private opaque link. Hovering or
keyboard-focusing that placeholder in the PDF preview loads the original image
through Typsastra's binary file command and shows one bounded overlay.

The overlay contract is:

- accept only a generation manifest ID produced by Typsastra;
- reject paths outside the current workspace;
- create at most one temporary object URL;
- revoke that URL when the overlay closes, the preview scrolls or zooms, or a
  new PDF generation is installed;
- never expose an unrestricted filesystem URL to the preview document.

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
- `preview.draft-hover`, including source bytes and intrinsic dimensions;
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
- [x] Placeholder hover/focus can show the original image on demand.
- [x] Draft placeholder clicks inverse-sync to their original image calls.
- [x] A render generation installs its mode and manifest atomically.
- [x] Final PDF export explicitly uses Normal Preview.
- [x] Rust and TypeScript tests cover parsing, ratios, routing, and migration.
- [ ] Runtime qualification is complete on Windows, Linux, and macOS.
- [ ] Image-heavy benchmark results are published.
