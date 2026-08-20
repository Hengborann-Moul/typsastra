# Enhanced Unicode Engine validation

Typsastra's Enhanced Unicode Engine is experimental. Its PDF output must be tested independently for:

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

## Use a local engine in Typsastra

Developer mode can use the enhanced `typst` executable from the Typsastra
engine release, or a compatible local build, for an explicit **Export PDF**
operation:

1. Download and extract the package for the current platform from the
   `enhanced-unicode-v0.1.0` release, or build the pinned enhanced Typst fork.
2. Open **Settings > Developer** and enable **Developer mode**.
3. Under **Enhanced Unicode PDF engine**, choose the local executable.
4. Leave **Use for PDF export** enabled and export the document normally.

Typsastra validates that the selected file is an executable compatible with
`typst --version` each time it is selected and again before export. The setting
stores only its absolute local path. Version 0.1.0 remains a manual download;
managed installation will use the checksummed release manifest in a later
Typsastra update.

This integration intentionally has a narrow boundary:

- live preview still uses the selected Tinymist toolchain,
- LSP, autocomplete, forward sync, and inverse sync still use Tinymist,
- disabling Developer mode restores the normal Tinymist export path, and
- an invalid or missing enhanced executable stops export with an explicit
  error instead of silently producing a normal PDF.

The automated geometry result only verifies that PDF.js produces finite rectangles contained by the page. It does not prove that those rectangles align accurately with every painted complex-script glyph. Viewer selection alignment remains part of the manual compatibility matrix.

In this mode, enhanced PDFs preserve authored space glyphs and PDF.js does not
infer additional spaces from the distance between positioned logical units. The
patch covers both PDF.js's browser build and the legacy Node build used by the
automated validator, so the report exercises the same extraction semantics as
Typsastra's standalone preview.

The patched PDF.js worker returns exact extraction for 7 of 10 cases and bounded
geometry for all 10. Typsastra then normalizes positioned RTL runs before
building its standalone text layer. This restores source-order Arabic for
search, DOM selection, and clipboard serialization without moving the painted
PDF coordinates. Devanagari remains engine-level work: PDF.js exposes
unsupported collection-font mappings as invalid control characters, and the
mixed fixture inherits that failure.

## Viewer compatibility matrix

The generated report contains an automated PDF.js row and placeholders for manual testing in:

- Adobe Acrobat Reader,
- Microsoft Edge,
- Google Chrome,
- Firefox, and
- macOS Preview.

### Verified Typsastra standalone preview

Typsastra now renders directly opened PDFs with bundled PDFium. PDF.js remains
the engine used by the automated comparison above and by live Typst previews;
the standalone viewer uses PDFium so its painted page, extracted characters,
and selectable geometry come from the same native PDF engine.

The current PDFium standalone preview has been manually checked against the
enhanced fixture:

| Capability | Result |
|---|---|
| Exact copied text | 9/10 labeled cases in the current manual fixture |
| Combining Latin, Khmer, Devanagari, Thai, and Lao | Exact |
| Arabic | Pure Arabic text is valid, but the mixed Latin label and RTL sentence are ordered incorrectly |
| Mixed script | Exact for the current fixture |
| Selection bounds | Remain inside the page |
| Complex-script rectangle alignment | Contiguous line-level geometry in the current fixture |

This confirms that PDFium avoids the invalid Devanagari mappings exposed by the
current PDF.js extraction path and provides stable selectable bounds for the
tested scripts. The remaining Arabic failure is a bidirectional run-ordering
issue in Typsastra's PDFium adapter, not missing Unicode data. Keep it visible
in the compatibility matrix until mixed LTR/RTL line reconstruction is exact.

For every viewer, manually record:

1. whether a complete labeled line can be selected without rectangles extending outside the page,
2. whether copied text matches the fixture exactly,
3. whether searching the exact authored sequence finds the line, and
4. whether mixed-direction selections remain visually attached to the selected text.

This matrix describes viewer compatibility; a viewer failure does not by itself prove that the exported PDF is invalid. A regression shared by multiple independent viewers is stronger evidence of an export defect.

## Engine release 0.1.0

The first reproducible engine packages are defined by
[`release-v0.1.0.json`](../toolchains/enhanced-unicode/release-v0.1.0.json) and
published from this repository under the scoped tag
`enhanced-unicode-v0.1.0`. Keeping the artifacts in the Typsastra repository
avoids presenting the Typst fork as an unrelated or official upstream binary.

The release remains explicitly opt-in and separate from Tinymist. It is used
only for explicit PDF exports and never replaces live preview, LSP,
autocomplete, diagnostics, or source synchronization. See the
[v0.1.0 engine release notes](ENHANCED_UNICODE_ENGINE_RELEASE_NOTES_V0.1.0.md)
for pinned source revisions, supported packages, and current validation scope.
