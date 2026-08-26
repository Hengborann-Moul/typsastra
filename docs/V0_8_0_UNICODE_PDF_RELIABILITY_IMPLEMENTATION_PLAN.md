# Typsastra v0.8.0 Unicode PDF Reliability Implementation Plan

## Objective

Ship v0.8.0 as a stabilization and integration milestone for reliable Unicode
PDF export and standalone PDF interoperability. The release productizes the
work added after v0.7.0 without introducing another large editor, preview-root,
or font-management architecture.

The release has one end-to-end contract:

```text
portable Typst source
  -> explicit PDF export
  -> reproducible compiler identity
  -> valid Unicode PDF
  -> standalone PDF viewing
  -> search, selection, links, outline, and clipboard interoperability
```

The optional Enhanced Unicode Engine remains experimental and opt-in. It is
used only for explicit PDF export. Tinymist remains authoritative for live
preview, diagnostics, autocomplete, formatting, and source synchronization.

## Scope boundaries

v0.8.0 does not include:

- portable Full Document and Active File preview modes;
- a broader font manager or project font-dependency dashboard;
- first-class right-to-left editor behavior;
- a broad autocomplete snippet library;
- original-image replacement or selective image-reference rewriting;
- redesigned document-language inheritance; or
- an SVG live-preview architecture.

Critical regressions in existing features remain in scope. Missing-font and
font-processing failures must be actionable, but v0.8.0 does not create a new
font ownership or packaging model.

## Existing implementation baseline

The following work landed after v0.7.0 and must be treated as an integrated
release candidate rather than independent experiments:

- managed, checksummed Enhanced Unicode Engine installation;
- Enhanced Unicode Engine v0.3.1 with the logical-unit v3 serializer;
- reproducible source and binary release metadata;
- PDF 1.4 through 2.0, PDF/A, and PDF/UA release validation;
- bundled PDFium rendering for directly opened PDFs;
- logical Unicode search and semantic text selection;
- selection context menus, PDF links, and document outlines;
- plain and formatted clipboard reconstruction;
- preservation of whitespace, boxes, and tables in formatted copy;
- search-marker, zoom-overlay, docking, and viewport fixes; and
- grapheme-aware desktop text controls.

## Workstream V08-E: Enhanced Unicode export productization

### Contract

- Installation is explicit and uses the pinned release manifest for the current
  platform.
- Archive byte length and SHA-256 are verified before installation.
- The installed executable is validated before it is selected and before each
  export.
- Enhanced export never replaces Tinymist for live services.
- Failure never silently falls back to ordinary export.
- Disabling the engine restores the ordinary Tinymist export path.
- The user can identify the engine version used for an export.

### Tasks

- [ ] **V08-E.1 Audit managed installation and recovery.** Cover first install,
  cancellation, retry, interrupted download, checksum mismatch, stale temporary
  files, missing installed files, and an executable that no longer validates.
- [ ] **V08-E.2 Add explicit repair behavior.** Let a user reinstall the pinned
  engine after validation failure without manually editing settings or cache
  directories.
- [ ] **V08-E.3 Report export provenance.** Include ordinary Tinymist or Enhanced
  Unicode Engine plus its validated version in success and diagnostic details.
- [ ] **V08-E.4 Make failures actionable.** Distinguish installation,
  validation, unsupported-version, source, font-processing, cancellation, and
  destination-write failures.
- [ ] **V08-E.5 Make final output transactional.** Compile to a temporary output,
  verify a non-empty PDF, and atomically replace the requested destination so a
  failed export cannot destroy a previous valid PDF.
- [ ] **V08-E.6 Preserve explicit consent.** Keep the engine default-off and
  clearly labeled experimental for v0.8.0.
- [ ] **V08-E.7 Lock regressions.** Compile the wide repeated-fill fixture and
  the multilingual extraction fixture with every released engine package.

## Workstream V08-P: Standalone PDF reliability

### Contract

A directly opened PDF uses the bundled PDFium path. Its page rendering, text
extraction, semantic selection geometry, search, links, and outline belong to
one generation-scoped document. PDF.js remains the live Typst-preview renderer.

### Tasks

- [ ] **V08-P.1 Qualify document replacement.** Cancel stale opens, searches,
  renders, overlays, outlines, and link state when another PDF replaces the
  document.
- [ ] **V08-P.2 Qualify viewport lifecycle.** Cover initial open, page jumps,
  continuous scrolling, fractional zoom, resize, dock, undock, and redock.
- [ ] **V08-P.3 Qualify navigation.** Cover internal destinations, external
  links, malformed destinations, outline expansion, and repeated page jumps.
- [ ] **V08-P.4 Qualify search.** Cover Unicode queries, mixed scripts, rapid
  query replacement, next/previous wraparound, virtualized pages, and cleared
  state after project replacement.
- [ ] **V08-P.5 Qualify selection.** Cover drag direction, multi-line and
  multi-page ranges, combining marks, grapheme boundaries, zoom, and page
  virtualization.
- [ ] **V08-P.6 Qualify hostile and unsupported input.** Cover malformed,
  password-protected, empty, oversized, and unsupported PDFs without exposing a
  stale prior document as the successful result.
- [ ] **V08-P.7 Measure native resources.** Record first-page latency, open/close
  cycles, rendered-page residency, and settled PDFium/WebView process memory on
  supported desktop platforms.

## Workstream V08-C: Unicode and clipboard interoperability

### Contract

Logical extraction, search matching, visual selection geometry, plain-text
copy, and formatted copy are related but independently tested capabilities. A
pass in one viewer or clipboard target is not proof of universal compatibility.

### Tasks

- [ ] **V08-C.1 Expand the fixture corpus.** Retain directly authored Latin,
  combining, Khmer, Arabic, Devanagari, Thai, Lao, mixed-script, punctuation,
  table, multi-font, long-line, and repeated-fill cases.
- [ ] **V08-C.2 Keep logical and visual checks separate.** Continue reporting
  exact text, whitespace-insensitive text, unexpected controls, finite geometry,
  and in-page geometry independently.
- [ ] **V08-C.3 Qualify plain copy.** Paste into a plain-text editor and compare
  exact Unicode, line structure, whitespace, and bidi ordering.
- [ ] **V08-C.4 Qualify formatted copy.** Verify paragraphs, boxes, and tables in
  representative rich-text and office applications without weakening the plain
  text fallback.
- [ ] **V08-C.5 Record viewer interoperability.** Test available versions of
  Acrobat Reader, Edge, Chrome, Firefox, and macOS Preview and record rather than
  infer their results.
- [ ] **V08-C.6 Resolve or disclose mixed-direction limitations.** Fix the known
  PDFium mixed Latin/Arabic ordering issue if it has a bounded PDF adapter
  solution. Do not pull the full RTL editor milestone into v0.8.0.

## Workstream V08-R: Reliability, performance, and release integration

### Tasks

- [ ] **V08-R.1 Run universal validation.** Keep frontend, Rust, Khmer, Lao,
  documentation, examples, and production builds passing.
- [ ] **V08-R.2 Publish measured PDFium gates.** Establish values from Windows
  and Linux measurements instead of copying PDF.js assumptions.
- [ ] **V08-R.3 Test export isolation.** Enhanced export must not mutate live
  preview ownership, Tinymist state, diagnostics, source maps, or unsaved text.
- [ ] **V08-R.4 Test project workflows.** Verify Unicode paths, imported
  projects, restored workspaces, direct PDFs, and exported PDFs across project
  replacement.
- [ ] **V08-R.5 Update current documentation.** Explain the three compiler/viewer
  roles, managed engine behavior, known limitations, recovery, and test scope.
- [ ] **V08-R.6 Run a bug-fix freeze.** After planned work is complete, accept
  only blocker, regression, documentation, packaging, and release-qualification
  changes until v0.8.0 ships.

## Proposed performance measurements

The following are measurement targets until v0.8.0 qualification publishes an
approved platform baseline. They must not be presented as passed before real
release builds are measured.

| Operation | Initial target |
|---|---:|
| First visible page for an ordinary standalone PDF | 1,000 ms |
| Zoom overlay refresh after settled zoom | 750 ms |
| Commit of stale search results | Never |
| Commit of stale page or selection overlays | Never |
| Native memory growth across repeated open/close | Bounded and documented |
| Resident rendered pages | Bounded and documented |

## Implementation phases

### Phase 0 — contracts and regression fixtures

- Establish this plan and the release qualification record.
- Add the wide repeated-fill engine fixture.
- Correct stale roadmap and managed-installation documentation.

### Phase 1 — bug fixing and lifecycle hardening

- Fix known export, PDFium, selection, search, clipboard, and docking defects.
- Add focused tests with each fix.

### Phase 2 — recovery and user-facing diagnostics

- Complete install repair, export provenance, transactional output, and
  actionable failure reporting.

### Phase 3 — platform qualification

- Run automated suites and manual viewer/clipboard matrices.
- Measure Windows and Linux release builds; qualify macOS where available or
  state its narrower evidence explicitly.

### Phase 4 — release freeze

- Update release notes and compatibility disclosures.
- Freeze features and resolve all blocker-severity regressions.
- Complete the v0.8.0 release qualification checklist.

## Release gate

v0.8.0 is eligible for release only when:

- every supported application build passes the universal validation suite;
- every released Enhanced Unicode Engine package compiles the multilingual,
  wide repeated-fill, and PDF-standards fixtures;
- every claimed PDF/A and PDF/UA profile passes the pinned validator;
- failed or cancelled export cannot replace a valid destination PDF;
- no enhanced-engine failure silently falls back to another compiler;
- standalone PDF replacement cannot commit stale search, selection, outline,
  link, page, or overlay state;
- native resource behavior is measured and documented;
- known mixed-direction and viewer-specific limitations are fixed or disclosed;
- existing Tinymist preview/export, Markdown, project interchange, Khmer, Lao,
  and grapheme editing regressions pass; and
- no known data-loss, security, crash, or blocker-severity export/PDF defect
  remains.

The tracked evidence belongs in
[`V0_8_0_RELEASE_QUALIFICATION.md`](V0_8_0_RELEASE_QUALIFICATION.md).
