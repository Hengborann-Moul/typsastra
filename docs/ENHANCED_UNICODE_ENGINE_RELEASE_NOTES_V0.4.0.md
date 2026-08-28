# Typsastra Enhanced Unicode Engine v0.4.0

This release compacts the physical TrueType glyph namespace used by logical
Unicode text while preserving v0.3's public API, semantic ordering, visual
positioning, and standard two-byte PDF character codes.

## Source identity

- Engine version: `0.4.0`
- Typst CLI compatibility: `0.15.1`
- Enhanced Typst revision: `821bf1bf6ad099531219647b268342fc87851a8b`
- Enhanced Krilla revision: `bb0873416484587814b9ecb682e262056f8effe2`
- License: Apache-2.0

## Changes since v0.3.1

- Embed only source glyphs used by each logical-font shard, including their
  transitive TrueType component dependencies.
- Reuse compact source-backed glyphs when a logical unit has one unpositioned
  component with its nominal advance.
- Retain synthetic composite glyphs for positioned, multi-component, or
  advance-adjusted visual units.
- Map semantic CIDs to compact embedded glyph IDs explicitly, allowing
  different Unicode sequences to share the same visual glyph without making
  extraction ambiguous.
- Track semantic-CID and embedded-glyph capacity independently so large source
  font namespaces do not force premature logical-font sharding.

The controlled v3-to-v4 Krilla corpus produced 85 pixel-identical rendered
pages and byte-identical Poppler raw extraction. Embedded glyph counts fell
from 2,707 to 2,279, and every fixture remained within 1.01% of its v3 PDF
size. These measurements qualify the namespace change; they do not expand the
published viewer-compatibility claims.

## Platform packages

The release workflow builds ZIP packages for Windows x64, Linux x64, Linux
ARM64, macOS x64, and macOS ARM64. Each package contains the compatible `typst`
executable, the Apache-2.0 license, and exact source metadata. The generated
`enhanced-unicode-manifest.json` records each archive's byte length and SHA-256
digest for Typsastra's managed installer.

## Validation

Every platform build must:

1. report the expected Typst 0.15.1 CLI version,
2. compile Typsastra's multilingual Enhanced Unicode fixture,
3. compile the wide repeated-fill regression fixture, and
4. compile PDFs for every supported base PDF version, PDF/A profile, and
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
