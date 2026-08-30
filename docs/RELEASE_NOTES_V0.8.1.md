# Typsastra v0.8.0 release notes

Typsastra v0.8.0 focuses on reliable multilingual PDF export and standalone
viewing. It adds an optional Enhanced Unicode Engine, substantially expands
Unicode-aware PDF interaction, and improves image workflows while preserving
Tinymist as the authority for editing and live preview services.

## Enhanced Unicode PDF export

- Added the optional Enhanced Unicode Engine v0.4.0 for explicit PDF export,
  improving logical Unicode extraction across Khmer, Arabic, Indic, Thai, Lao,
  and mixed-script documents.
- Added on-demand managed installation for pinned Windows x64, Linux x64 and
  ARM64, and macOS x64 and ARM64 packages with exact archive-size and SHA-256
  verification.
- Kept the enhanced engine export-only. Tinymist remains authoritative for live
  preview, diagnostics, completion, formatting, and source synchronization.
- Made PDF compilation cancellable and transactional. A failed or cancelled
  export does not replace an existing valid destination PDF.
- Reported whether an export used Tinymist, the managed Enhanced Unicode Engine,
  or a custom Typst executable so compiler provenance is never implicit.

## Standalone PDF viewing

- Added bundled PDFium rendering for directly opened PDFs while retaining the
  patched PDF.js viewer for Typst live preview.
- Added deterministic Unicode-aware search, semantic text selection, selection
  context actions, and logical plain-text copy for complex scripts.
- Added **Copy with Formatting** with plain-text fallback and support for
  available paragraph, heading, caption, box, figure, and table structure.
- Added internal and external PDF links, document-outline navigation, and a
  search action in the standalone PDF toolbar.
- Preserved search and selection overlays across page virtualization and zoom,
  and refreshed coordinate-dependent overlays after viewport changes.
- Preserved page-relative viewport state across docking, undocking, preview
  restarts, and generated-PDF replacement, including when unchanged generated
  bytes are discarded.
- Added clear errors for password-protected, malformed, empty, and unsupported
  PDFs instead of leaving stale document content visible.
- Improved fractional-zoom sharpness, mixed-script interaction, selection
  feedback, and linked-text drag selection.

## Image and file workflows

- Added external file drag-and-drop into Explorer destinations without silently
  overwriting existing files.
- Added project-image and external-image drag-and-drop into Typst editors at a
  tracked caret position.
- Added multi-image drop and clipboard image paste with collision-safe storage
  under the project `images` directory.
- Added one insertion choice per image batch: plain `image(...)` calls or
  individual `figure(...)` calls with editable captions.
- Preserved normal text paste and prevented asynchronous clipboard saves from
  inserting syntax after the active document changes.
- Added structured metadata for opened images and PDFs, including file details,
  raster dimensions, and PDF page count.

## Editing and workspace reliability

- Applied grapheme-aware movement, selection, and deletion across editor and
  desktop text controls while preserving native IME composition and numeric
  control behavior.
- Routed **Select All** to the focused editor, PDF surface, or text control
  instead of selecting application chrome.
- Reset search state when projects change and improved active-file diagnostic
  navigation.
- Rejected stale filesystem, lazy-tab, and preview updates during rapid external
  changes or project replacement.

## Compatibility and known limitations

v0.8.0 does not change the `.typsastra` project archive schema. Existing v0.7.x
projects remain compatible. Enhanced Unicode Engine v0.4.0 is optional,
experimental, and used only when explicitly selected for export.

The published v0.4.0 viewer matrix records exact tested versions for Firefox,
Chrome, Brave, Edge, Acrobat, Okular, SumatraPDF, ONLYOFFICE, and Typsastra.
Viewer extraction, selection, copy, and search behavior still varies because
independent viewers reconstruct PDF text differently. Typsastra passed rendering,
selection, and copy/paste checks, with 12/12 successful searches.

Exact mixed Latin/Arabic reconstruction in PDFium remains a documented
limitation rather than a first-class right-to-left editing claim. Rich copy also
depends on semantic structure available in the source PDF. First-class RTL
editor behavior, portable Full Document/Active File preview, broader font
management, and selective single-reference image rewriting remain deferred.
