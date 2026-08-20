# Enhanced Unicode Engine validation

Typsastra's Enhanced Unicode Engine is experimental. Before it can become an optional developer toolchain, its PDF output must be tested independently for:

1. logical Unicode extraction,
2. copy and paste,
3. search,
4. text-selection geometry, and
5. behavior across independent PDF viewers.

Successful extraction in one library is not proof that every PDF viewer will draw correct selection rectangles. The validation harness therefore reports logical text and geometry separately.

## Run the automated comparison

Build the enhanced Typst fork in release mode, then run:

```sh
bun run validate:enhanced-unicode
```

By default, the harness compares the `typst` executable on `PATH` with a sibling checkout at:

```text
../typst-unicode-pdf/target/release/typst
```

Override either executable when needed:

```sh
bun run validate:enhanced-unicode -- \
  --baseline /path/to/official/typst \
  --enhanced /path/to/enhanced/typst
```

On Windows, `.exe` paths are accepted normally. The environment variables `TYPSASTRA_BASELINE_TYPST` and `TYPSASTRA_ENHANCED_TYPST` provide the same overrides.

Generated artifacts are written to:

```text
artifacts/enhanced-unicode/
├── baseline.pdf
├── enhanced.pdf
├── report.json
└── report.md
```

The command is diagnostic by default, so incomplete engine work still produces a comparison report. Once the enhanced engine is expected to pass every automated check, use strict mode in its release workflow:

```sh
bun run validate:enhanced-unicode -- --strict
```

## Test corpus

The fixture at `tests/fixtures/enhanced-unicode/unicode-selection.typ` contains directly authored, labeled lines for:

- precomposed Latin text,
- decomposed combining sequences,
- Khmer,
- Arabic,
- Devanagari,
- Thai,
- Lao,
- mixed-script text, and
- punctuation and Khmer digits.

Directly authored lines keep Typsastra source navigation meaningful and avoid hiding exporter defects behind generated content.

## Automated results

For each case, the harness records:

| Check | Meaning |
|---|---|
| Exact logical text | Extracted Unicode is byte-for-byte equivalent to the authored line. |
| Whitespace-insensitive text | The logical characters survive, but the viewer may be inferring unwanted spaces between positioned units. |
| Geometry | PDF.js text items are finite and remain within page bounds. |
| Unexpected controls | Extracted C0 control characters indicate an invalid Unicode mapping. |

The PDF.js check uses Typsastra's pinned `pdfjs-dist` patch with `preserveLogicalText`. It tests the logical-text items used by standalone PDF selection, search, and Typsastra's custom clipboard serialization.

The automated geometry result only verifies that PDF.js produces finite rectangles contained by the page. It does not prove that those rectangles align accurately with every painted complex-script glyph. Viewer selection alignment remains part of the manual compatibility matrix.

In this mode, enhanced PDFs preserve authored space glyphs and PDF.js does not
infer additional spaces from the distance between positioned logical units. The
patch covers both PDF.js's browser build and the legacy Node build used by the
automated validator, so the report exercises the same extraction semantics as
Typsastra's standalone preview.

The current reference run passes exact extraction for 7 of 10 cases and bounded
geometry for all 10. Combining Latin, Khmer, Thai, and Lao now pass exactly. The
remaining failures are engine-level work: Arabic still needs line-level logical
ordering, while Devanagari and the mixed fixture expose unsupported collection
font mappings and invalid control characters.

## Viewer compatibility matrix

The generated report contains an automated PDF.js row and placeholders for manual testing in:

- Adobe Acrobat Reader,
- Microsoft Edge,
- Google Chrome,
- Firefox, and
- macOS Preview.

### Verified Typsastra standalone preview

The current Typsastra standalone preview has been manually verified against the
enhanced fixture. Its custom clipboard path reproduces the patched PDF.js
logical extraction result:

| Capability | Result |
|---|---|
| Exact copied text | 7/10 cases |
| Combining Latin, Khmer, Thai, and Lao | Exact |
| Arabic | Incorrect visual-order sequence |
| Devanagari | Invalid C0 controls remain |
| Mixed script | Fails because it contains the Arabic and Devanagari cases |
| Selection bounds | Remain inside the page |
| Complex-script rectangle alignment | Fragmented or offset in some clusters |

This confirms that Typsastra's clipboard reconstruction no longer introduces
the inferred spaces produced by native DOM selection. It does not repair text
already returned incorrectly by PDF.js. Arabic ordering and Devanagari decoding
must be resolved in the enhanced PDF/PDF.js integration rather than in the
clipboard serializer.

For every viewer, manually record:

1. whether a complete labeled line can be selected without rectangles extending outside the page,
2. whether copied text matches the fixture exactly,
3. whether searching the exact authored sequence finds the line, and
4. whether mixed-direction selections remain visually attached to the selected text.

This matrix describes viewer compatibility; a viewer failure does not by itself prove that the exported PDF is invalid. A regression shared by multiple independent viewers is stronger evidence of an export defect.

## Current gate

Do not offer the enhanced compiler in Typsastra's developer settings until:

- strict automated validation passes for the supported scripts,
- the fork is built reproducibly on every supported platform,
- the manual viewer matrix is recorded for release artifacts, and
- installation remains explicitly opt-in and separate from Tinymist.
