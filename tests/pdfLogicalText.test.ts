import { expect, test } from "bun:test";
import {
  findPdfTextMatches,
  normalizePdfLogicalTextContent,
  reorderPdfLogicalTextItems,
} from "../src/preview/pdfLogicalText";

function item(str: string, x: number, dir = "ltr", y = 100) {
  return { str, dir, transform: [1, 0, 0, 1, x, y], height: 10 };
}

test("reorders positioned Arabic words into logical reading order", () => {
  const items = [
    item("EU-ARABIC-01: ", 10),
    item("و", 100, "rtl"),
    item("ا", 90, "rtl"),
    item(" ", 110),
    item("ا", 140, "rtl"),
    item("ل", 130, "rtl"),
    item("ع", 120, "rtl"),
    item(".", 150),
  ];

  expect(reorderPdfLogicalTextItems(items).map((entry: any) => entry.str).join(""))
    .toBe("EU-ARABIC-01: الع وا.");
});

test("does not reorder RTL items across visual lines", () => {
  const items = [
    item("ا", 100, "rtl", 100),
    item(" ", 110, "ltr", 100),
    item("ب", 140, "rtl", 80),
  ];

  expect(reorderPdfLogicalTextItems(items)).toEqual(items);
});

test("normalization preserves the text-content container", () => {
  const source = {
    items: [item("و", 100, "rtl"), item(" ", 110), item("ا", 140, "rtl")],
    styles: { f1: { fontFamily: "serif" } },
    lang: "ar",
  };
  const normalized = normalizePdfLogicalTextContent(source);

  expect(normalized).not.toBe(source);
  expect(normalized.styles).toBe(source.styles);
  expect(normalized.items.map(entry => entry.str).join("")).toBe("ا و");
});

test("finds a logical query spanning separately positioned glyph items", () => {
  const items = reorderPdfLogicalTextItems([
    item("و", 100, "rtl"),
    item("ا", 90, "rtl"),
    item(" ", 110),
    item("ا", 140, "rtl"),
    item("ل", 130, "rtl"),
    item("ع", 120, "rtl"),
  ]);

  expect(findPdfTextMatches(items, "الع وا")).toEqual([[
    { itemIndex: 0, from: 0, to: 1 },
    { itemIndex: 1, from: 0, to: 1 },
    { itemIndex: 2, from: 0, to: 1 },
    { itemIndex: 3, from: 0, to: 1 },
    { itemIndex: 4, from: 0, to: 1 },
    { itemIndex: 5, from: 0, to: 1 },
  ]]);
});
