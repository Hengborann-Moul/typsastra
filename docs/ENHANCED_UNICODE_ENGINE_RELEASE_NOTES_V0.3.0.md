# Typsastra Enhanced Unicode Engine v0.3.0

This release updates Typsastra's optional Enhanced Unicode PDF export engine
to its third-generation logical-text serializer. It remains an explicit
developer option distributed from the Typsastra repository rather than an
official upstream Typst binary.

The engine is based on Typst 0.15.1. It preserves authored Unicode sequences
for shaped complex-script text while retaining the visual glyph output used
by the document. Version 0.3.0 keeps the v0.2.0 logical-unit and font-sharding
architecture, but serializes compatible units as one positioned `TJ` array and
retains the active logical font inside each PDF text object. Positioning values
are rounded to two decimal places in PDF text space to remove insignificant
floating-point tails.

## Source identity

- Engine version: `0.3.0`
- Typst CLI compatibility: `0.15.1`
- Enhanced Typst revision: `102a9d2b473da71f45122afb72dba512022993c6`
- Enhanced Krilla revision: `d05158cf3ebead248745f846d0397e84dfb9f2d0`
- License: Apache-2.0

## Changes since v0.2.0

- Reuse the selected logical-font shard within a PDF text object and emit `Tf`
  only when the shard changes.
- Collect compatible units on the same baseline and shard into one positioned
  `TJ` array instead of restarting each group with `Tf`, `Tm`, and `Tj`.
- Keep character codes in authoritative logical order and reproduce shaped
  visual positions with `TJ` numeric adjustments, including backward movement
  in right-to-left runs.
- Round positioning adjustments to two decimal places in PDF text space,
  removing unstable floating-point tails and improving stream compression.
- Stop batching at shard transitions, baseline changes, invalid coordinates, or
  placements that cannot be expressed safely as a horizontal adjustment.
- Do not reintroduce `/ActualText` or a hybrid conventional-text route.

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

The [v0.3.0 benchmark](ENHANCED_UNICODE_ENGINE_BENCHMARKS_V0.3.0.md) reports
that the positioned `TJ` serializer reduces all five benchmark PDFs relative
to v0.2.0 while keeping Poppler extraction byte-identical and Krilla's test
suites green.

## Scope

This optional engine is used only for explicit PDF export. Tinymist remains
the compiler and language service for live preview, autocomplete, diagnostics,
and source synchronization.
