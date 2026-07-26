# Typsastra v0.5.3 release notes

Typsastra v0.5.3 is a preview-reliability, storage-efficiency, and workflow-
safety update. It strengthens PDF preview and source synchronization under
external edits, copied workspaces, large assets, and system resume while
keeping generated artifacts out of the user’s project files.

Released July 26, 2026.

## Preview reliability and responsiveness

- Replaced Base64 PDF transport with file-backed binary loading, reducing
  transient JavaScript memory pressure during preview replacement.
- Deferred PDF presentation and cleanup while a pane is being resized, keeping
  interaction responsive during compilation and page rendering.
- Prevented generated PDFs and cache changes from recursively triggering new
  preview builds.
- Kept live-preview source mirrors, generated PDFs, source maps, and temporary
  compiler artifacts under `.typsastra/cache`.
- Continued requiring explicit confirmation before Typsastra creates or
  replaces an exported PDF in the workspace.
- Added recovery after sleep or hibernate for interrupted resize state and
  stale preview WebSocket connections. Resume timing remains platform- and
  driver-dependent, so this path will continue to be monitored.

## Source synchronization

- Rebuilt externally edited documents through the same revision-safe preview
  pipeline used for in-app edits.
- Made hidden source-map warm-up independent of the active cursor mapping to
  rendered content, so comments, directives, blank lines, and other
  non-rendered positions no longer prevent readiness.
- Increased the source-map proxy’s accepted frame size while filtering
  oversized vector snapshots that PDF forward and inverse sync do not need.
- Preserved the small position messages used by forward and inverse sync.
- Rebuilt stale source-map sessions after cache migration and system resume.

## Cache and workspace portability

- Materialized non-Typst render assets as hard links when the filesystem
  supports them, avoiding a second physical copy of large image collections.
- Retained a regular-copy fallback on filesystems where hard links are
  unavailable.
- Added cache ownership metadata so a workspace copied with `.typsastra` can
  detect that its cache belongs to another path.
- Invalidated and rebuilt copied caches before Tinymist and source-map services
  start, restoring correct links and mappings for the new workspace.
- Prevented generated preview output from recursively nesting
  `.typsastra/cache` directories.

## Large PDFs and direct PDF viewing

- Required confirmation before decoding large direct PDF files, including
  files restored as the active tab during workspace startup.
- Cancelled stale PDF load requests when the active tab or preview target
  changes.
- Disabled Typst inverse synchronization for directly opened PDFs.
- Gave direct PDF viewing a gray surface while retaining the white document
  surface for live Typst preview.

## Image-heavy document guidance

- Added non-destructive raster-image profiling based on decoded pixel memory,
  source size, reference count, and unique-image count.
- Added a non-blocking warning indicator to the preview toolbar. Compilation
  continues in both **On type** and **On save** modes.
- Added navigable image warnings in the editor gutter and a dedicated
  **Images** category in Problems.
- Added adaptive recommendations:
  - always flag images estimated above 64 MiB when decoded;
  - always flag source images larger than 8 MiB;
  - when aggregate decoded image memory exceeds 256 MiB, also identify major
    contributors above 32 MiB, with bounded aggregate-only suggestions.
- Distinguished downscaling guidance, which reduces decoded memory and
  compilation work, from compression or re-encoding guidance, which reduces
  source and potentially exported-PDF size.
- Never hid, downsampled, converted, replaced, or rewrote source images.
  Dynamic image paths and unsupported formats continue without blocking the
  preview when Typsastra cannot inspect them safely.

## Editing and project workflow

- Improved editor search with visible-first matching, folded-range handling,
  centered navigation, and current/total match counts.
- Closed the search panel when the user resumes editing.
- Kept autocomplete and other CodeMirror tooltips above preview overlays.
- Removed missing recent projects after showing an explanatory app-styled
  dialog and receiving acknowledgement.

## Upgrade behavior

Typsastra installs bundled examples into `Typsastra Examples v0.5.3`. Earlier
versioned example folders remain untouched as user-owned workspaces.

Existing `.typsastra` workspace settings remain compatible. Render caches are
disposable and may be rebuilt when their recorded workspace ownership does not
match the current project path.

## Known boundaries

- Image profiling covers statically discoverable supported raster references.
  Dynamic paths, package resources, plugins, and unsupported containers may not
  receive recommendations.
- Hard links require the source and cache to reside on a compatible filesystem.
  Typsastra falls back to regular copies when linking is unavailable.
- Resume recovery has regression coverage but remains sensitive to intermittent
  WebView2, GPU-driver, and display-scaling behavior.
- Draft Preview and private project font folders are planned for v0.6.0.
- Markdown live preview and broader resource-aware authoring are planned for
  v0.7.0.
- Portable Full Document and Active File preview modes remain planned for
  v0.8.0.
- First-class RTL editing remains planned for the v0.9.0 prerelease.
- The experimental macOS build remains unsigned and unnotarized.
- Fonts remain external dependencies and are never included in project
  exports.
