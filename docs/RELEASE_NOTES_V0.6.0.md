# Typsastra v0.6.0 release notes

Typsastra v0.6.0 introduces Draft Preview and private local font directories,
with broader improvements to document navigation, diagnostics, editing, and
image-heavy project workflows.

Released July 29, 2026.

## Draft Preview

- Added a workspace-specific **Normal/Draft** preview toggle.
- Replaced statically resolvable image calls in Typsastra's private render
  mirror with linked, layout-preserving Typst block placeholders.
- Preserved intrinsic aspect ratios and common explicit or implicit sizing for
  standalone image calls and images inside clipped blocks without modifying
  the source document.
- Added cached hover thumbnails with source dimensions and encoded size.
- Scoped thumbnail discovery and storage to images reachable from the selected
  main document, with separate cache identities for unrelated main files in
  the same project.
- Prioritized thumbnail generation by visible-page relevance and source cost,
  bounded generated thumbnails to compact preview assets, and reused cached
  thumbnails across sessions.
- Kept placeholder clicks connected to inverse sync and retained source
  navigation in both docked and undocked preview windows.
- Ensured PDF export always compiles the original images through Normal
  Preview rather than exporting Draft placeholders.
- Published Normal-versus-Draft measurements for optimized and pathological
  image fixtures in [BENCHMARKS.md](./BENCHMARKS.md).

## Private local fonts

- Added global private font directories for fonts that should be available to
  Typst without being installed into the operating system.
- Grouped Document Typography choices as Typst built-in, private local, and
  system fonts.
- Rejected ambiguous family collisions between private directories and other
  available font sources.
- Applied private font paths consistently to diagnostics, preview, source
  mapping, and PDF export, restarting the compiler session when paths change.
- Kept absolute font paths in machine-local settings only. Typsastra never
  copies private font binaries into `.typsastra`, project archives, generated
  font variants, or exports.
- Supported desktop TTF, OTF, TTC, and OTC files from private directories.
  WOFF and WOFF2 remain unsupported web-font formats; variable TTF and OTF
  files are supported at `1.0×`, without arbitrary variation-axis controls.

## Language tools and document typography

- Routed spellcheck and word completion from each file's Document Typography
  configuration, allowing files in one project to select different language
  providers.
- Lazily initialized language providers only when a document requests them,
  reducing unnecessary project startup work.
- Restored dictionary word completion after lazy provider activation.
- Kept script-specific editor fonts and fallback policies active across tab
  and editor-state replacement.

## Preview navigation and synchronization

- Added `Alt+Enter` manual forward sync and rejected source positions that
  cannot produce a valid preview mapping before starting a timeout.
- Added `Ctrl`/`Command` preview link discovery, visually distinguishing
  internal references from external links.
- Preserved preview scroll position across recompilation and project reopening,
  and added a return-to-first-page control.
- Recovered source synchronization after external edits, compiler stops,
  cache migration, and common cold-start races.
- Invalidated stale source-map caches after project files are reorganized.
- Retained Draft hover interaction, theme state, document position, and
  navigation behavior when the preview is undocked and redocked.

## Compilation and diagnostics

- Separated editor diagnostics from preview-mirror revisions so temporary
  syntax errors no longer leave stale LSP diagnostics or block a corrected
  recompilation.
- Preserved the last successful preview while showing a compilation-error
  overlay for the current revision.
- Surfaced package compatibility failures as persistent compiler errors in the
  preview, Problems console, counters, and LSP status instead of exposing only
  an internal Tinymist export message.
- Recompiled render-on-save projects when reachable template files change.
- Unified cached mirror preparation for render-on-type, render-on-save, and
  Draft Preview while keeping their trigger behavior distinct.

## Editor and project workflow

- Opened files fully unfolded by default and persisted only folds explicitly
  created by the user.
- Improved contextual completion so function arguments take priority and
  unrelated global suggestions do not activate inside an argument list.
- Opened unknown files internally when they contain plain text, retaining
  Unicode and complex-script editor behavior.
- Improved bracket-pair matching, caret and selection geometry, indentation
  guides, warning gutters, and theme-aware active states.
- Preserved per-tab undo history and fixed stale undo behavior after switching
  files.
- Added wheel and gesture scrolling to the tab strip.
- Hid dot-prefixed directories from the project explorer.
- Used native system prompts for missing recent projects, unsaved-file exit,
  and PDF export or replacement. Export now uses a save-file selector.
- Persisted preview render mode per project and kept welcome-screen status
  actions limited to Settings.

## Responsive preview layout

- Added a compact preview toolbar that moves zoom, sync, refresh, export, and
  undock actions into an overflow menu as the pane narrows.
- Enforced a minimum pane width based on the packed toolbar, including when the
  Explorer is reopened.
- Preserved the previous docked preview width after an undock/redock cycle.
- Kept Draft toggle labels stable while switching modes and closed preview
  menus when the user clicks the menu button or preview surface.

## Upgrade behavior

Typsastra installs bundled examples into `Typsastra Examples v0.6.0`. Earlier
versioned example folders remain untouched as user-owned projects.

Existing `.typsastra` project settings remain compatible. Preview render mode
is now stored per project. Render, source-map, and thumbnail caches are
disposable and may be rebuilt when their project ownership or main-document
identity changes.

The previous automatic default-fold state is intentionally not migrated. Files
open unfolded until the user creates and persists a fold.

## Known boundaries

- Draft placeholder geometry and interaction are qualified for standalone
  image calls and images inside clipped blocks. Other image compositions may
  produce different placeholder sizing or interaction and should be checked in
  Normal Preview.
- PDF files referenced as image assets are not profiled or replaced by Draft
  Preview. They remain unchanged for Normal Preview and export. Meaningful
  optimization guidance requires future analysis of page selection, embedded
  rasters, vector complexity, fonts, and transparency rather than relying on
  the PDF's file size alone.
- The first Draft Preview use must generate thumbnails for uncached images.
  Pathological source images can make that initial preparation noticeably
  slower; later cache hits are substantially faster.
- Switching an image-heavy document from Normal to Draft reduces subsequent
  work but may not immediately return memory retained by Tinymist. Restart the
  project to reclaim that compiler session when necessary.
- Private local fonts are machine-local dependencies. Collaborators must
  install the font or configure their own private directory.
- Advanced inspection, deletion, and renewal of scaled-font variants and
  complete font-dependency health reporting remain planned work.
- Very large single source files, such as the 20,000-line stress fixture, can
  still show intermittent editor-scroll latency.
- Moving or reorganizing project files outside Typsastra while the project is
  open can invalidate cached source maps. Close and reopen the project, or
  remove the disposable `.typsastra/cache` directory, after external moves.
- The experimental macOS build remains unsigned and unnotarized.

See the [v0.6.0 feature showcase](../README.md#v060-feature-showcase) for video
demonstrations.
