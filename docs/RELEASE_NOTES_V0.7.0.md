# Typsastra v0.7.0 release notes

Typsastra v0.7.0 builds on v0.6.3 with resource-aware image workflows, secure
Markdown live preview, stronger editor navigation, clearer compiler errors, and
more reliable desktop integration.

Released August 13, 2026.

## Markdown live preview

- Added Markdown syntax highlighting and a separate live-preview surface for
  `.md` and `.markdown` files.
- Rendered common GitHub-Flavored Markdown constructs, including headings,
  lists, task lists, tables, block quotes, links, code, and local images.
- Sanitized generated HTML and blocked scripts, forms, embedded documents,
  event handlers, injected styles, and automatic remote-image loading.
- Restricted local resources to the open workspace and opened workspace links
  through Typsastra's existing file policy.
- Preserved per-document Markdown scroll state and retained the bounded PDF
  session when switching between Markdown and Typst files.
- Kept Markdown isolated from Typst completion, spellcheck routing, Tinymist,
  PDF export, and source synchronization.

## Image Tools and font cache management

- Added an Image Tools workspace that inventories local raster images and shows
  dimensions, encoded size, estimated decoded size, format, document usage,
  and statically discovered Typst references.
- Added filters for current-document, referenced, unused, and optimization-
  recommended images, plus bounded image previews and comparison controls.
- Added explicit resize and PNG/JPEG/WebP re-encoding previews with output and
  decoded-size estimates.
- Saved optimization results as new copies and optionally updated all indexed
  static Typst references to the new path. Original assets are never silently
  overwritten.
- Updated static image references after project image renames and allowed an
  author-selected project image to replace indexed static paths.
- Added Settings controls to inspect, renew, delete, and clean unused generated
  scaled-font variants while preserving variants referenced by saved workspace
  typography.

## Editor, search, and diagnostics

- Added selectable bracket-pair editing that wraps, removes, or replaces
  quotes, parentheses, brackets, and braces while preserving selection
  direction.
- Redesigned the search panel with compact accessible controls and added
  selected-text, search-result, diagnostic, image-warning, and caret markers to
  the editor scrollbar.
- Preserved each tab's scroll position, undo history, parsed syntax tree, folds,
  selection, diagnostics, and bracket colors across tab switches and Tinymist
  restarts.
- Added member completion on the right side of `#let` assignments and corrected
  closure indentation without enabling prose-like member suggestions.
- Updated the pinned Khmer segmenter to v0.2.0-rc.3 and
  selected visual spelling accuracy so legacy COENG DA/TA variants such as
  `ស្ដាប់` and `ស្តាប់` are accepted as equivalent correct spelling while
  visual prefixes receive completion suggestions in the curated form.
- Allowed any browser-accessible installed font in the source editor while
  retaining fixed-width indentation metrics and complex-script fallbacks.
- Rendered compiler failures as structured, navigable source frames, including
  related call sites and decoded workspace paths, and cleared stale diagnostics
  after successful compilation or external file updates.
- Added a persisted editor-toolbar toggle and platform-correct shortcut labels.

## Projects, toolchains, and desktop reliability

- Added a cancellable project-import destination step with editable portable
  folder names, conflict checking, and transactional extraction. Archive schema
  version 2 remains unchanged.
- Added discovery and selection of validated Tinymist installations from the
  system `PATH` alongside managed stable downloads.
- Hardened managed downloads with bounded streaming, retries, real byte
  progress, stall detection, and time-limited executable validation.
- Added a native macOS application menu, corrected macOS shortcut labels, and
  verified DMG structure in the release workflow.
- Initialized Xlib thread support before GTK/WebKit on Linux and prevented stale
  WebKitGTK Ctrl state from flashing reference links while scrolling live
  preview.
- Improved workspace close, replacement, resume, sidebar restoration, preview
  loading, and diagnostic recovery across the extracted controller lifecycle.
- Added universal frontend and Rust CI checks and standardized local Tauri
  commands as `bun run tauri:dev` and `bun run tauri:build`.

## Compatibility and deferred work

v0.7.0 does not change the `.typsastra` project archive schema. Existing v0.6.x
projects open without migration. The release installs a new writable
`Typsastra Examples v0.7.0` folder and does not overwrite earlier example
workspaces.

The implementation does not overwrite original images, selectively rewrite a
single reference, redesign document-language inheritance, provide complete
toolchain or font-dependency health dashboards, or publish resource-workflow
benchmarks. Those refinements moved to v0.8.0 together with portable Full
Document and Active File preview work.
