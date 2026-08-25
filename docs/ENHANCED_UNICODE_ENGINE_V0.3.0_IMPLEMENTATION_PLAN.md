# Enhanced Unicode Engine v0.3.0 implementation plan

## Objective

Version 0.3.0 should retain the logical Unicode correctness and complex-script
size improvements of v0.2.0 while making logical-unit serialization efficient
for ordinary Latin and bidirectional Arabic text.

The target architecture remains:

```text
authored Unicode
      ↓
shaped visual glyphs + logical units
      ↓
semantics-preserving PDF serialization
      ↓
compact searchable, selectable, and extractable PDF
```

The optimization must not restore visual-glyph order as the authoritative
Unicode order merely to reduce bytes.

## Baseline and reproducibility

Before changing serialization, establish a controlled benchmark baseline:

1. Build both variants from the same Typst revision, Krilla revision, Rust
   toolchain, profile, target, and feature set.
2. Make the conventional and logical-unit paths selectable by one explicit
   feature or runtime switch.
3. Run at least 30 randomized, interleaved measurements per fixture.
4. Report cold-start and warmed medians separately, together with dispersion
   such as p95 or median absolute deviation.
5. Record source revisions, binary hashes, fixture hashes, exact PDF bytes,
   operator counts, and raw timing samples in machine-readable output.
6. Publish the generated report and artifact hashes with the engine release.

The v0.2.0 English, Khmer, Arabic, Devanagari, and mixed documents become the
initial regression corpus. Add short fixtures for transforms, vertical
offsets, multiple font shards, mixed LTR/RTL runs, ligatures, combining marks,
and line wrapping.

## Phase 1: serializer instrumentation

Add counters around logical serialization for:

- input logical units,
- contiguous groups,
- logical-font shards,
- shard transitions,
- emitted `Tf`, `Tm`, `Tj`, and `TJ` operators,
- units rejected from batching and their reason,
- content-stream bytes, and
- `/ActualText` occurrences.

The benchmark report should break these down by page and script fixture. This
turns English and Arabic growth into directly observable decisions rather than
an inferred outcome from final PDFs.

## Phase 2: retain PDF text state

Krilla v0.2.0 selects the logical font for every contiguous group. Track the
active font resource and size within the text object and emit `Tf` only when
the logical-font shard or font size changes.

```text
v0.2.0:
Tf  Tm  Tj
Tf  Tm  Tj
Tf  Tm  Tj

v0.3.0 first step:
Tf  Tm  Tj
    Tm  Tj
    Tm  Tj
```

Acceptance requires byte-identical extracted Unicode and visually equivalent
rendering. Tests must cover shard boundaries so state is never reused across
the wrong logical font.

## Phase 3: encode safe positioning with `TJ`

Represent safe horizontal displacement inside a logical run with `TJ`
adjustments rather than restarting every group with `Tm`.

```text
Tm [(unit-1) adjustment (unit-2) adjustment (unit-3)] TJ
```

Only combine units when all of the following hold:

- they use the same logical-font shard and text state,
- their baselines and transforms are compatible,
- the displacement is representable within an explicit numeric tolerance,
- logical code order remains authoritative, and
- the result does not cross a tagging or marked-content boundary.

Retain separate `Tm` operations for vertical changes, incompatible transforms,
shard changes, or placements that cannot be represented safely. Do not treat
visual adjacency alone as permission to reorder RTL logical units.

## Phase 4: optimize bidirectional runs

Arabic is the priority fixture because v0.2.0 emits 38,207 individually
positioned groups in the measured document.

Build explicit tests for:

- pure RTL paragraphs,
- an LTR label followed by Arabic,
- Arabic with Latin numbers and punctuation,
- nested directional isolates,
- ligatures and combining marks, and
- selection and extraction across direction changes.

The serializer may divide a run into safe directional segments, but the PDF
character codes must continue to describe the authored logical Unicode. Each
optimization must pass exact extraction, search, selection, and visual raster
comparison before it is enabled.

## Phase 5: decide universal versus hybrid routing

Evaluate two strategies after state reuse and `TJ` positioning are complete.

### Preferred: optimized universal logical path

Use `PdfLogicalUnit` for all supported text if its size and speed are near the
conventional path for ordinary Latin. This avoids two semantic implementations
and provides one predictable extraction model.

### Fallback: conservative hybrid path

If ordinary text still regresses materially, retain the conventional CID path
only when its Unicode mapping is provably unambiguous. Route complex shaping,
multi-codepoint mappings, reordered runs, or other ambiguous cases through
`PdfLogicalUnit`.

A hybrid decision must be deterministic and covered by tests. It must never
silently choose compact output at the cost of authored Unicode. Avoid
script-name heuristics; choose based on shaping and mapping properties.

## Phase 6: conformance and viewer validation

Run the existing Typsastra standards matrix for every candidate:

- PDF 1.4 through PDF 2.0,
- all supported PDF/A profiles,
- PDF/UA-1, and
- supported combined PDF/A and PDF/UA output.

In addition to veraPDF conformance, validate:

- exact Unicode extraction,
- absence of unexpected control characters,
- search across complex-script graphemes,
- selection and clipboard output in Typsastra's PDFium viewer,
- Acrobat, Chromium, Firefox, and PDF.js interoperability,
- tagged structure and reading order,
- link and outline preservation, and
- pixel or perceptual comparison against v0.2.0 rendering.

Standards compliance and viewer behavior are separate gates; neither replaces
the other.

## Acceptance targets

Use exact byte counts from the controlled benchmark, not rounded table values.

- Preserve every v0.2.0 exact-extraction and PDF conformance result.
- Preserve visually equivalent output for all fixtures.
- Keep Khmer and Devanagari output within 5% of v0.2.0 size.
- Reduce the English regression from +52.8% to at most +10% versus stock.
- Reduce the Arabic regression from +210.8% to at most +25% versus stock.
- Keep the mixed document no larger than its v0.2.0 output.
- Emit no redundant `Tf` when adjacent groups use the same font shard and
  size.
- Do not reintroduce `/ActualText` merely as a size optimization.
- Show no statistically meaningful compilation-time regression versus the
  controlled conventional-path build.

If Arabic cannot meet the initial size target without weakening semantics,
publish the measured limitation rather than enabling an unsafe optimization.

## Delivery milestones

1. Reproducible A/B harness and committed raw-result schema.
2. Logical serializer counters and operator report.
3. Font-state reuse with regression tests.
4. Safe `TJ` positioning for ordinary LTR runs.
5. Direction-aware positioning for RTL and mixed-direction runs.
6. Universal-versus-hybrid routing decision backed by benchmark data.
7. Full standards, extraction, geometry, and viewer matrix.
8. Reproducible v0.3.0 packages and release report.

## Non-goals

This plan does not change Typsastra's live-preview compiler, Tinymist, editor
source synchronization, or rich-text clipboard reconstruction. It concerns
the enhanced Typst/Krilla PDF serialization path and the documentation and
validation artifacts Typsastra publishes for that optional engine.
