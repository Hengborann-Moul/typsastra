# Typsastra Enhanced Unicode Engine v0.1.0

This is the first reproducible release of Typsastra's optional Enhanced Unicode
PDF export engine. It is distributed from the Typsastra repository to keep the
application and its compatible developer toolchain in one trusted location.

The engine is based on Typst 0.15.1 and preserves logical Unicode units when
exporting shaped complex-script text through Krilla. It is intended to improve
text extraction, search, copy and paste, and selection interoperability in PDF
viewers without changing the visual document layout.

## Source identity

- Engine version: `0.1.0`
- Typst CLI compatibility: `0.15.1`
- Enhanced Typst revision: `ee922252539d51e6520caa8a3bd3808f708f5f50`
- Enhanced Krilla revision: `92cd34f2f9b7ff2d02b7d2b358d7d7a27e3c1dce`
- License: Apache-2.0

## Platform packages

The release workflow builds ZIP packages for Windows x64, Linux x64, Linux
ARM64, macOS x64, and macOS ARM64. Each package contains the compatible `typst`
executable, its Apache-2.0 license, and exact source metadata. The generated
`enhanced-unicode-manifest.json` records each archive's byte length and SHA-256
digest for managed installation in a future Typsastra update.

## Validation

Every platform build must:

1. report the expected Typst 0.15.1 CLI version,
2. compile Typsastra's multilingual Enhanced Unicode fixture, and
3. produce a non-empty PDF before it can be attached to the draft release.

The engine has been manually exercised with Typsastra's PDFium standalone
preview across Latin, combining marks, Khmer, Arabic, Devanagari, Thai, Lao,
mixed-script text, punctuation, search, selection, and clipboard workflows.

## Scope

This optional engine is used only for explicit PDF export. Tinymist remains the
compiler and language service for live preview, autocomplete, diagnostics, and
source synchronization. The packages are Typsastra developer toolchain assets,
not official upstream Typst binaries.
