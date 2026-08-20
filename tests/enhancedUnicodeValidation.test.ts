import { expect, test } from "bun:test";
import {
  analyzeUnicodeTextItems,
  compactWhitespace,
  parseUnicodeFixtureCases,
  type PdfTextItemGeometry
} from "../scripts/enhanced-unicode-validation-core";

test("Enhanced Unicode fixtures expose directly authored labeled cases", async () => {
  const source = await Bun.file("tests/fixtures/enhanced-unicode/unicode-selection.typ").text();
  const cases = parseUnicodeFixtureCases(source);
  expect(cases.length).toBeGreaterThanOrEqual(8);
  expect(cases.some(item => item.id === "EU-KHMER-01")).toBe(true);
  expect(cases.some(item => item.id === "EU-ARABIC-01")).toBe(true);
  expect(cases.some(item => item.id === "EU-COMBINING-01")).toBe(true);
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

