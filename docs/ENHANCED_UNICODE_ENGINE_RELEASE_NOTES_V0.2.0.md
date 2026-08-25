# Typsastra Enhanced Unicode Engine v0.2.0

This release updates Typsastra's optional Enhanced Unicode PDF export engine
to its second-generation logical-text architecture. It remains an explicit
developer option distributed from the Typsastra repository rather than an
official upstream Typst binary.

The engine is based on Typst 0.15.1. It preserves authored Unicode sequences
for shaped complex-script text while retaining the visual glyph output used
by the document. The updated Krilla architecture separates logical text from
ordinary CID fonts and shards logical Identity-H fonts at the TrueType glyph
limit. This removes the previous single-font capacity bottleneck for large or
text-heavy PDFs.

## Source identity

- Engine version: `0.2.0`
- Typst CLI compatibility: `0.15.1`
- Enhanced Typst revision: `ed70c365edc912efd0f30cbce8ddbbbc0551243e`
- Enhanced Krilla revision: `0cf4da659c6bae966fcec71e26d6d937185c95c9`
- License: Apache-2.0

## Changes since v0.1.0

- Store logical text in dedicated Identity-H PDF fonts instead of the ordinary
  visual CID font.
- Shard logical fonts before reaching the TrueType glyph identifier limit.
- Conservatively batch contiguous logical units to reduce PDF operators and
  resource overhead.
- Keep visual rendering and authored logical Unicode as separate concerns.
- Remove obsolete Krilla experiment binaries and document the v1 and v2
  logical-text architectures in the source repository.

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

Typsastra's validation fixture covers Latin, combining marks, Khmer, Arabic,
Devanagari, Thai, Lao, mixed-script text, punctuation, search, selection, and
clipboard workflows. The new architecture is intended to improve extraction
scalability without changing document layout.

The [v0.2.0 prose benchmark](ENHANCED_UNICODE_ENGINE_BENCHMARKS_V0.2.0.md)
shows that the size benefit is workload-dependent rather than universal.
Unique Khmer and Devanagari prose becomes substantially smaller, while the
current conservative serializer makes English and Arabic output larger. See
the [v0.3.0 implementation plan](ENHANCED_UNICODE_ENGINE_V0.3.0_IMPLEMENTATION_PLAN.md)
for the proposed text-state, positioning, RTL, and controlled-benchmark work.

## Scope

This optional engine is used only for explicit PDF export. Tinymist remains
the compiler and language service for live preview, autocomplete, diagnostics,
and source synchronization.
