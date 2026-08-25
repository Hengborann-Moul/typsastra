# Enhanced Unicode Engine v0.2.0 benchmarks

This report evaluates the second-generation `PdfLogicalUnit` architecture on
ordinary, non-repeated prose. It complements the repeated-line stress fixture:
the goal here is to determine whether the earlier improvements survive when
paragraphs and lines are unique.

## Method

Five documents were generated with normal page layout, justification, page
numbering, and Typst's default tagged-PDF output. Each single-script document
contains 80 unique paragraphs. The mixed document contains 320 unique
paragraphs distributed across English, Khmer, Arabic, and Devanagari.

Both binaries were warmed before measurement. Stock and v0.2.0 compilations
were alternated for seven runs per document, and the median elapsed time was
recorded.

## Results

| Document | Pages | Stock PDF | v0.2.0 PDF | Size change | Stock median | v0.2.0 median | Relative speed |
|---|---:|---:|---:|---:|---:|---:|---:|
| English | 14 | 86.0 KiB | 131.4 KiB | **+52.8%** | 0.319 s | 0.270 s | **1.18x** |
| Khmer | 10 | 495.7 KiB | 83.8 KiB | **-83.1%** | 0.887 s | 0.664 s | **1.34x** |
| Arabic | 10 | 106.6 KiB | 331.4 KiB | **+210.8%** | 0.268 s | 0.235 s | **1.14x** |
| Devanagari/Hindi | 9 | 258.4 KiB | 119.5 KiB | **-53.7%** | 0.357 s | 0.305 s | **1.17x** |
| Mixed multilingual | 42 | 1.47 MiB | 1.09 MiB | **-25.5%** | 1.377 s | 1.129 s | **1.22x** |

The size percentages were calculated from the original byte counts. The
displayed KiB and MiB values are rounded, so recalculating from the table can
produce a slightly different percentage, particularly for the mixed file.

The central result is not that enhanced Unicode output is always smaller.
Instead:

> `PdfLogicalUnit` substantially reduces output size when the conventional
> glyph-oriented representation is expensive for complex shaping, but the
> current serializer can increase output size for text that the conventional
> PDF path already represents compactly.

All five measured medians favor v0.2.0, but those timings are directional
rather than an isolated causal measurement. The stock and enhanced binaries
are different revisions rather than two builds of one source revision with
only the logical-unit path toggled. A controlled v0.3.0 benchmark must use the
same commits, compiler flags, and environment for both variants.

## PDF operator evidence

The content-stream counts explain why file-size behavior differs by script.

| Document | Variant | `BT` | `Tm` | `Tf` | `TJ` | `Tj` | `/ActualText` |
|---|---|---:|---:|---:|---:|---:|---:|
| English | Stock | 686 | 686 | 686 | 640 | - | 0 |
| English | v0.2.0 | 686 | 7,110 | 7,110 | - | 7,110 | 0 |
| Khmer | Stock | - | 25,732 | 25,732 | 15,204 | 10,528 | 13,302 |
| Khmer | v0.2.0 | - | 2,145 | 2,145 | 1 | 2,144 | 0 |
| Arabic | Stock | - | 6,469 | - | 6,019 | - | 384 |
| Arabic | v0.2.0 | - | 38,207 | - | - | 38,207 | 0 |
| Devanagari | Stock | - | 24,074 | - | - | - | 14,602 |
| Devanagari | v0.2.0 | - | 6,616 | - | - | - | 0 |
| Mixed | Stock | 48,071 | 69,297 | - | - | - | 28,276 |
| Mixed | v0.2.0 | 32,021 | 65,265 | - | - | - | 0 |

A dash means that the benchmark did not record that counter; it does not mean
the operator was absent.

### Khmer and Devanagari

The reductions survive unique prose. Khmer falls from about 508 KB to 86 KB,
while Devanagari falls from about 265 KB to 122 KB. Both results coincide with
far fewer text matrices and the removal of thousands of `/ActualText`
occurrences. The repeated-line corpus amplified the earlier result but did not
create it.

### English

The stock path is already compact: most ordinary Latin lines fit in a single
positioned `TJ` array. In v0.2.0, authoritative logical units are combined only
when their visual positions are exactly contiguous. The remaining groups each
require a font selection, text matrix, and `Tj`, increasing the PDF from about
88 KB to 135 KB.

### Arabic

Arabic exposes the largest current serialization cost. Logical Unicode is
cleaner and no longer depends on `/ActualText`, but shaping and bidirectional
placement cause conservative grouping to emit many individually positioned
units. The resulting 38,207 `Tm`/`Tj` pairs increase the file from about
109 KB to 339 KB.

### Mixed multilingual prose

The mixed workload is the most representative aggregate in this set. Despite
the English and Arabic regressions, the Khmer and Devanagari reductions lower
the 42-page document from 1.47 MiB to 1.09 MiB while retaining exact logical
text semantics.

## Validation of the interpretation

The reported arithmetic is internally consistent: every relative-speed value
matches `stock median / v0.2.0 median`, and every displayed size percentage is
consistent with the supplied exact-byte measurements after rounding.

The implementation mechanism was also checked against the pinned enhanced
Typst and Krilla sources:

- Typst constructs logical units in source order and retains their shaped
  visual positions.
- Krilla groups units only when they use the same logical-font shard and pass
  its visual-contiguity check.
- Each resulting group currently emits `Tf`, `Tm`, and `Tj`.

These facts support the operator-count explanation and the v0.3.0 optimization
direction. The raw benchmark corpus, binaries, PDFs, and per-run timing logs
are not stored in this repository, so the observed totals are documented here
as supplied measurements rather than independently reproduced results. Future
release benchmarks should publish those artifacts or their hashes.

## Conclusion

Enhanced Unicode Engine v0.2.0 demonstrates that authoritative logical units
can improve both semantics and compactness for complex scripts without relying
on repeated text. It is not yet an efficient universal serializer. Version
0.3.0 should preserve v0.2.0's logical-text guarantees while reducing repeated
font selections and text matrices, with Arabic and ordinary Latin serving as
the primary size-regression fixtures.
