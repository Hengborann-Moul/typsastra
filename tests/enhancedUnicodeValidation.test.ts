import { expect, test } from "bun:test";
import {
  analyzeUnicodeTextItems,
  compactWhitespace,
  parseUnicodeFixtureCases,
  type PdfTextItemGeometry
} from "../scripts/enhanced-unicode-validation-core";

test("PDFium validation uses the released engine and production text adapter", async () => {
  const script = await Bun.file("scripts/run-pdfium-unicode-validation.ts").text();
  const example = await Bun.file("src-tauri/examples/pdfium_text_dump.rs").text();
  const packageJson = await Bun.file("package.json").json();

  expect(packageJson.scripts["validate:pdfium-unicode"]).toBe(
    "bun scripts/run-pdfium-unicode-validation.ts",
  );
  expect(script).toContain("buildPdfiumTextRuns");
  expect(script).toContain('startsWith(`${fixtureCase.id}:`)');
  expect(script).toContain("if (exact !== results.length) process.exitCode = 1");
  expect(example).toContain("pdfium_bundled::bind_bundled()");
  expect(example).toContain("char.unicode_string()");
});

test("Enhanced Unicode v0.4.0 carries forward the published viewer matrix unchanged", async () => {
  const validation = await Bun.file("docs/ENHANCED_UNICODE_ENGINE_VALIDATION.md").text();
  const releaseNotes = await Bun.file("docs/ENHANCED_UNICODE_ENGINE_RELEASE_NOTES_V0.4.0.md").text();
  const rows = [
    "| Chrome | 151.0.7922.174 (Official Build, 64-bit) | Pass | Pass | Pass | 12/12 |",
    "| Brave | 1.94.117 (Official Build, 64-bit) | Pass | Pass | Pass | 12/12 |",
    "| Microsoft Edge | 151.0.4129.107 (Official build, 64-bit) | Pass | Pass | Pass | 12/12 |",
    "| Okular | 25.08.1 | Pass | Pass | Pass | Pass |",
    "| SumatraPDF | 3.6.1 | Pass | Pass | Pass | Pass |",
    "| Adobe Acrobat | 2022.001.20085 | Pass | Pass | Pass | 6/12 |",
    "| Firefox | 154.0.1 (64-bit) | Pass | Partial | Partial | 0/12 |",
    "| ONLYOFFICE Desktop Editors Community | 9.3.1.8 (x64 exe) | Pass | Pass visually | Fail | 0/12 |",
    "| Typsastra | 0.8.0 | Pass | Pass | Pass | 12/12 |",
  ];

  for (const row of rows) {
    expect(validation).toContain(row);
    expect(releaseNotes).toContain(row);
  }
  expect(releaseNotes).toContain("viewer result is upgraded or downgraded");
  expect(releaseNotes).toContain("recording the tested");
  expect(releaseNotes).toContain("operating systems");
});

test("Enhanced Unicode fixtures expose directly authored labeled cases", async () => {
  const source = await Bun.file("tests/fixtures/enhanced-unicode/unicode-selection.typ").text();
  const cases = parseUnicodeFixtureCases(source);
  expect(cases.length).toBeGreaterThanOrEqual(8);
  expect(cases.some(item => item.id === "EU-KHMER-01")).toBe(true);
  expect(cases.some(item => item.id === "EU-ARABIC-01")).toBe(true);
  expect(cases.some(item => item.id === "EU-COMBINING-01")).toBe(true);
});

test("Enhanced Unicode release locks the wide repeated-fill regression", async () => {
  const fixturePath = "tests/fixtures/enhanced-unicode/wide-repeated-fill.typ";
  const source = await Bun.file(fixturePath).text();
  const workflow = await Bun.file(".github/workflows/enhanced-unicode-engine-release.yml").text();

  expect(source).toContain("logical component coordinate exceeds i16");
  expect(source).toMatch(/box\(width:\s*(?:1[5-9]\d|[2-9]\d\d)mm,\s*repeat\[\.\]\)/u);
  expect(workflow).toContain(fixturePath);
  expect(workflow).toContain("enhanced-unicode-wide-fill-smoke-test.pdf");
});

test("Unicode validation distinguishes inferred whitespace from changed text", () => {
  expect(compactWhitespace("ភាសា ខ្មែរ")).toBe(compactWhitespace("ភាសាខ្មែរ"));
  expect(compactWhitespace("العربية")).not.toBe(compactWhitespace("ةيبرعلا"));
});

test("Unicode validation rejects out-of-page selection geometry and controls", () => {
  const item = (str: string, x: number): PdfTextItemGeometry => ({
    pageNo: 1,
    str,
    width: 20,
    height: 10,
    transform: [1, 0, 0, 1, x, 40],
    pageView: [0, 0, 100, 100]
  });
  const cases = [{ id: "EU-TEST-01", expected: "EU-TEST-01: valid" }];
  expect(analyzeUnicodeTextItems(cases, [item("EU-TEST-01: valid", 10)])[0]).toMatchObject({
    exactLogicalText: true,
    geometryInsidePage: true,
    unexpectedControlCharacters: []
  });
  expect(analyzeUnicodeTextItems(cases, [item("EU-TEST-01: val\u0002id", 95)])[0]).toMatchObject({
    exactLogicalText: false,
    geometryInsidePage: false,
    unexpectedControlCharacters: ["U+0002"]
  });
});

