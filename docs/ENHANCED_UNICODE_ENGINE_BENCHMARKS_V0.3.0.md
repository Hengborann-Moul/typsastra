# Enhanced Unicode Engine v0.3.0 benchmarks

## Summary

Version 0.3.0 keeps the v0.2.0 logical-unit and font-sharding architecture,
but serializes compatible units as one positioned `TJ` array and retains the
active logical font inside each PDF text object. Positioning values are rounded
to two decimal places in PDF text space to remove insignificant floating-point
tails.

This reduces all five benchmark PDFs relative to v0.2.0. It also meets the
v0.3.0 size targets for ordinary English and Arabic without hybrid routing or
script-specific behavior.

## Method

The v0.2.0 English, Khmer, Arabic, Devanagari, and mixed fixtures were compiled
with the same pinned static Noto fonts and `--ignore-system-fonts`.

Each binary was warmed once on every fixture. The measured run contained 30
samples for every binary and fixture combination. All 15 combinations were
randomized within each round. The table reports the warmed median, median
absolute deviation (MAD), and p95 wall time.

The v0.2.0 and v0.3.0 binaries use the same Typst integration revision. The
stock binary is the official Typst 0.15.1 build and therefore remains a nearby,
not source-identical, conventional-path comparison. The timing results should
be interpreted with that limitation; the PDF byte and operator comparisons are
deterministic for the supplied artifacts.

## Results

| Document | Variant | PDF bytes | Change vs stock | Median | MAD | p95 |
|---|---|---:|---:|---:|---:|---:|
| English | Stock | 82,169 | — | 0.225887 s | 0.032757 s | 0.548414 s |
| English | v0.2.0 | 128,633 | +56.5% | 0.175063 s | 0.022622 s | 0.318256 s |
| English | v0.3.0 | 89,896 | **+9.4%** | 0.175378 s | 0.021057 s | 0.400933 s |
| Khmer | Stock | 506,849 | — | 0.748282 s | 0.071724 s | 1.744016 s |
| Khmer | v0.2.0 | 78,841 | -84.4% | 0.708525 s | 0.086501 s | 1.684750 s |
| Khmer | v0.3.0 | 70,384 | **-86.1%** | 0.665870 s | 0.083822 s | 1.476663 s |
| Arabic | Stock | 102,634 | — | 0.195718 s | 0.031016 s | 0.477052 s |
| Arabic | v0.2.0 | 332,851 | +224.3% | 0.156242 s | 0.017302 s | 0.264790 s |
| Arabic | v0.3.0 | 89,484 | **-12.8%** | 0.145064 s | 0.012434 s | 0.339384 s |
| Devanagari/Hindi | Stock | 267,454 | — | 0.296962 s | 0.040883 s | 0.626947 s |
| Devanagari/Hindi | v0.2.0 | 115,202 | -56.9% | 0.223434 s | 0.023881 s | 0.460783 s |
| Devanagari/Hindi | v0.3.0 | 76,687 | **-71.3%** | 0.223013 s | 0.022601 s | 0.420920 s |
| Mixed multilingual | Stock | 1,533,379 | — | 1.298126 s | 0.134683 s | 2.688455 s |
| Mixed multilingual | v0.2.0 | 1,141,527 | -25.6% | 1.324271 s | 0.197126 s | 3.173592 s |
| Mixed multilingual | v0.3.0 | 1,062,016 | **-30.7%** | 1.307506 s | 0.203955 s | 2.644160 s |

Relative to v0.2.0, v0.3.0 reduces output by 30.1% for English, 10.7% for
Khmer, 73.1% for Arabic, 33.4% for Devanagari, and 7.0% for the mixed fixture.
The warmed medians show no material regression: English and Devanagari are
effectively unchanged, while Khmer, Arabic, and mixed improve by approximately
6%, 8%, and 1% respectively.

## PDF operator evidence

| Document | Variant | `BT` | `Tf` | `Tm` | `TJ` | `Tj` | `/ActualText` |
|---|---|---:|---:|---:|---:|---:|---:|
| English | v0.2.0 | 686 | 7,110 | 7,110 | 0 | 7,110 | 0 |
| English | v0.3.0 | 686 | 686 | 686 | 556 | 130 | 0 |
| Khmer | v0.2.0 | 457 | 2,145 | 2,145 | 1 | 2,144 | 0 |
| Khmer | v0.3.0 | 457 | 457 | 457 | 370 | 87 | 0 |
| Arabic | v0.2.0 | 357 | 38,207 | 38,207 | 0 | 38,207 | 0 |
| Arabic | v0.3.0 | 357 | 357 | 357 | 347 | 10 | 0 |
| Devanagari | v0.2.0 | 435 | 6,616 | 6,616 | 0 | 6,616 | 0 |
| Devanagari | v0.3.0 | 435 | 435 | 435 | 346 | 89 | 0 |
| Mixed | v0.2.0 | 32,021 | 65,265 | 65,265 | 0 | 65,265 | 0 |
| Mixed | v0.3.0 | 32,021 | 32,021 | 32,021 | 6,715 | 25,306 | 0 |

The logical character codes remain in source order. `TJ` numeric adjustments
reproduce independently shaped visual positions, including backward movement
inside right-to-left runs. Version 0.3.0 does not reintroduce `/ActualText`.

## Validation

- All 15 stock, v0.2.0, and v0.3.0 benchmark PDFs pass `qpdf --check`.
- Poppler `pdftotext -raw` output is byte-identical between v0.2.0 and v0.3.0
  for every fixture.
- At 72 DPI, 44 pages differ from v0.2.0 because of positioning-value
  quantization; the worst PSNR is 51.20 dB, which is visually negligible.
- PDF 1.4, 1.5, 1.6, 1.7, and 2.0 outputs pass qpdf syntax checks.
- Every Typst-supported PDF/A profile passes veraPDF: A-1b, A-1a, A-2b,
  A-2u, A-2a, A-3b, A-3u, A-3a, A-4, A-4f, and A-4e.
- PDF/UA-1 and the combined PDF/A-2b + PDF/UA-1 output pass veraPDF.
- Krilla's library and all-feature library suites both pass 31 tests.

## Reproducibility identifiers

- Source archive SHA-256:
  `12E92A489DD2DCAB9D533C21C1548E06320B14B14FB5DA3051EB41E83D72B213`
- Stock Typst binary SHA-256:
  `D4D1B61D9E9C8F0A8DF967F92899AA01C5E126BCD4AB51657642D7A72BF69663`
- v0.2.0 binary SHA-256:
  `97DAB20200493D1151A8F7C50142F2AF32B707DB7055B13C971E7F9FBF0EC6F0`
- v0.3.0 benchmark binary SHA-256:
  `724C36C5E980D4E41FC0620E34AABE264CD98BC52F91351E0B6DF6859AB755BF`
- Typst integration revision: `ed70c365edc912efd0f30cbce8ddbbbc0551243e`
- Krilla v0.3.0 revision: `94d3481150014659ff181fdb9c1163d1d17a40f5`

The fixture corpus is synthetic unique-paragraph prose assembled from repeated
phrase components. It avoids repeated complete lines, but it should not be
described as a natural-language corpus.

## Conclusion

The preferred universal logical path is viable for v0.3.0. Retained text state,
positioned `TJ` batching, and stable numeric serialization eliminate the large
Latin and Arabic regressions without weakening Unicode semantics or requiring
a hybrid conventional-text route. Version 2 font sharding and standard
two-byte `Identity-H` CIDs remain unchanged.
