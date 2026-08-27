# Typsastra v0.8.0 Release Qualification

## Status

**In preparation.** This document is a release evidence record, not a claim that
v0.8.0 is ready. Leave an item unchecked until the named command or manual test
has actually completed and its result has been reviewed.

The implementation contract is in the
[v0.8.0 Unicode PDF Reliability plan](V0_8_0_UNICODE_PDF_RELIABILITY_IMPLEMENTATION_PLAN.md).

## Candidate identity

Record these values when release qualification begins:

| Field | Value |
|---|---|
| Typsastra commit | pending |
| Application version | 0.8.0 |
| Managed Tinymist version | pending |
| Embedded Typst version | pending |
| Enhanced Unicode Engine version | 0.3.1 |
| Enhanced Typst revision | `75202cf09a26a5ef5dfd0f26ab7a4fe007e1be39` |
| Enhanced Krilla revision | `d05158cf3ebead248745f846d0397e84dfb9f2d0` |
| PDFium package | `pdfium-bundled 0.1.1` |
| PDF.js package | `pdfjs-dist 6.2.108` plus Typsastra patch |
| Qualification dates | pending |

## Automated validation

Record the commit, platform, date, and artifact or log link for each completed
run.

- [ ] `bun install --frozen-lockfile`
- [ ] `bun test`
- [ ] `bun run build`
- [ ] `bun run conform`
- [ ] `bun run test:khmer`
- [ ] `bun run test:lao`
- [ ] `bun run test:docs`
- [ ] `bun run validate:examples`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --package typsastra -- --check`
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml --lib`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- [ ] `bun run tauri:build`
- [ ] `git diff --check`

### Enhanced Unicode Engine

- [ ] Every platform package reports the expected Typst version.
- [ ] Every platform package compiles `unicode-selection.typ`.
- [ ] Every platform package compiles `wide-repeated-fill.typ`.
- [ ] Every platform package produces all supported base PDF versions.
- [ ] Linux x64 passes every claimed PDF/A and PDF/UA profile with the pinned
  veraPDF release.
- [ ] The release manifest records the exact byte length and SHA-256 of every
  archive.
- [ ] Managed installation rejects a changed byte length.
- [ ] Managed installation rejects a changed SHA-256.
- [ ] Managed installation recovers from cancellation and an interrupted
  download without presenting a partial executable as installed.

## Export safety matrix

| Scenario | Ordinary Tinymist export | Enhanced export | Result/evidence |
|---|---|---|---|
| Valid one-page document | pending | pending | pending |
| Multilingual fixture | pending | pending | pending |
| Wide repeated fill | pending | pending | pending |
| Missing font | pending | pending | pending |
| Invalid source | pending | pending | pending |
| Existing destination PDF | pending | pending | pending |
| Cancellation during compile | pending | pending | pending |
| Read-only destination | pending | pending | pending |
| Unicode and spaces in path | pending | pending | pending |
| Long Windows path | pending | pending | pending |
| Engine executable removed | not applicable | pending | pending |
| Engine executable invalid | not applicable | pending | pending |

Required outcomes:

- [ ] A failed or cancelled export does not replace a previous valid PDF.
- [ ] Enhanced export never silently falls back to Tinymist.
- [ ] Disabling Enhanced Unicode export restores the ordinary path.
- [ ] Success and diagnostic details identify the compiler used.
- [ ] Export does not change live preview, diagnostics, LSP, source-map, or
  unsaved editor state.

## Standalone PDF matrix

Test an ordinary small PDF, the enhanced multilingual fixture, a large approved
PDF, and malformed/unsupported inputs.

- [ ] Initial page appears without exposing a stale previous document.
- [ ] Rapid document replacement cancels stale work.
- [ ] Search supports Latin, combining text, Khmer, Arabic, Devanagari, Thai,
  Lao, punctuation, and mixed-script queries.
- [ ] Rapidly replacing a query cannot commit stale matches.
- [ ] Search markers survive page virtualization and clear on document change.
- [ ] Selection remains attached after zoom and resize.
- [ ] Selection works in both drag directions and across lines/pages.
- [ ] Plain copy preserves expected Unicode and whitespace.
- [ ] Formatted copy preserves supported paragraphs, boxes, and tables.
- [ ] Internal links and outline destinations navigate correctly.
- [ ] External links use the existing confirmation/opening policy.
- [ ] Dock, undock, redock, and color-mode changes preserve valid viewport state.
- [ ] Password-protected, malformed, empty, and unsupported PDFs fail clearly.
- [ ] Repeated open/close cycles release document resources within the published
  bound.

## Viewer interoperability

Record exact application versions and operating systems. Use **not available**
rather than inventing a result for an unavailable platform.

| Viewer | Version/OS | Text extraction | Search | Selection geometry | Copy/paste | Notes |
|---|---|---|---|---|---|---|
| Typsastra PDFium | pending | pending | pending | pending | pending | pending |
| Typsastra patched PDF.js | pending | pending | pending | pending | pending | pending |
| Adobe Acrobat Reader | pending | pending | pending | pending | pending | pending |
| Microsoft Edge | pending | pending | pending | pending | pending | pending |
| Google Chrome | pending | pending | pending | pending | pending | pending |
| Firefox | pending | pending | pending | pending | pending | pending |
| macOS Preview | pending | pending | pending | pending | pending | pending |

Published historical evidence:

- The [Typst Forum viewer matrix](https://forum.typst.app/t/typsastra-enhanced-unicode-engine-for-better-unicode-in-pdfs/9709)
  records v0.1.0 Khmer rendering, selection, copy/paste, and search results for
  Chrome, Brave, Edge, Okular, SumatraPDF, Acrobat, Firefox, and ONLYOFFICE.
  Treat it as prior evidence, not as a completed v0.3.1 row, because exact
  viewer versions and operating systems were not recorded.

Known issue requiring a release decision:

- [ ] Mixed Latin/Arabic PDFium reconstruction is exact, or its limitation is
  documented in release notes and user-facing compatibility guidance.

## Performance and resource evidence

Measure release builds. Browser heap alone is insufficient; record Typsastra,
WebView, renderer/GPU, PDFium/native backend, and compiler processes where the
platform exposes them.

| Platform/workload | First page | Search | Zoom settle | Settled memory | Open/close delta | Evidence |
|---|---:|---:|---:|---:|---:|---|
| Windows, small PDF | pending | pending | pending | pending | pending | pending |
| Windows, large PDF | pending | pending | pending | pending | pending | pending |
| Linux, small PDF | pending | pending | pending | pending | pending | pending |
| Linux, large PDF | pending | pending | pending | pending | pending | pending |
| macOS, if available | pending | pending | pending | pending | pending | pending |

- [ ] First-page and zoom measurements meet the approved v0.8 targets or the
  plan records and justifies revised targets.
- [ ] Rendered-page and native-memory bounds are documented.
- [ ] No stale generation becomes visible after cancellation or replacement.

## Regression coverage

- [ ] Normal Tinymist live preview and PDF export.
- [ ] PDF.js live-preview virtualization and source synchronization.
- [ ] Markdown preview lifecycle.
- [ ] Project import/export and Unicode archive paths.
- [ ] Workspace restoration and project replacement.
- [ ] Khmer editing and provider fixtures.
- [ ] Lao provider fixtures.
- [ ] Global grapheme-aware text controls.
- [ ] Search state reset across project changes.
- [ ] Direct-PDF large-file approval and cancellation.

## Platform packages

| Package | Install | Upgrade | Launch | Export | Direct PDF | Uninstall | Evidence |
|---|---|---|---|---|---|---|---|
| Windows MSI/NSIS | pending | pending | pending | pending | pending | pending | pending |
| Linux DEB | pending | pending | pending | pending | pending | pending | pending |
| Linux RPM | pending | pending | pending | pending | pending | pending | pending |
| Linux AppImage | pending | not applicable | pending | pending | pending | not applicable | pending |
| macOS DMG | pending | pending | pending | pending | pending | pending | pending |

## Documentation and release freeze

- [ ] `ROADMAP.md` reflects the final delivered scope.
- [ ] Settings and troubleshooting documentation match managed v0.3.1 behavior.
- [ ] Release notes distinguish Tinymist, Enhanced Unicode export, PDF.js live
  preview, and PDFium standalone viewing.
- [ ] Experimental and known-limitation labels are accurate.
- [ ] Migration or compatibility notes are complete.
- [ ] Feature freeze has started.
- [ ] No known data-loss, security, crash, or blocker-severity PDF/export issue
  remains.
- [ ] All accepted post-freeze fixes include focused regression coverage.

## Release decision

- [ ] **Approved for v0.8.0**

Approver, date, candidate commit, and unresolved non-blocking limitations:

```text
pending
```
