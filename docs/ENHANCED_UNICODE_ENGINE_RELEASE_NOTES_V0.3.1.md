# Typsastra Enhanced Unicode Engine v0.3.1

This patch release fixes a font-processing failure that could abort PDF export
when a document contained a wide repeated-fill text run, such as a dotted
outline leader.

## Source identity

- Engine version: `0.3.1`
- Typst CLI compatibility: `0.15.1`
- Enhanced Typst revision: `75202cf09a26a5ef5dfd0f26ab7a4fe007e1be39`
- Enhanced Krilla revision: `d05158cf3ebead248745f846d0397e84dfb9f2d0`
- License: Apache-2.0

## Changes since v0.3.0

- Cap a logical unit's visual width so a repeated-fill run is not synthesized
  as one oversized TrueType composite glyph.
- Fall back to ordinary glyph drawing when a unit would exceed the i16
  component-coordinate range. This prevents the
  `logical component coordinate exceeds i16` export error.

## Platform packages

The release workflow builds ZIP packages for Windows x64, Linux x64, Linux
ARM64, macOS x64, and macOS ARM64. Each package contains the compatible `typst`
executable, the Apache-2.0 license, and exact source metadata. The generated
`enhanced-unicode-manifest.json` records each archive's byte length and SHA-256
digest for Typsastra's managed installer.

## Validation

Every platform build must:

1. report the expected Typst 0.15.1 CLI version,
2. compile Typsastra's multilingual Enhanced Unicode fixture, and
3. compile PDFs for every supported base PDF version, PDF/A profile, and
   PDF/UA-1 combination before the release is published.

The release gate covers PDF 1.4, 1.5, 1.6, 1.7, and 2.0; all eleven PDF/A
profiles exposed by Typst; PDF/UA-1; and compatible PDF/A-2a+PDF/UA-1 and
PDF/A-3a+PDF/UA-1 combinations. The Linux x64 artifacts are independently
checked with pinned veraPDF 1.30.2. Publication is blocked unless every
claimed PDF/A and PDF/UA profile is reported compliant.

## Scope

This optional engine is used only for explicit PDF export. Tinymist remains
the compiler and language service for live preview, autocomplete, diagnostics,
and source synchronization.
