import { expect, test } from "bun:test";
import {
  hitTestStandalonePdfSelection,
  serializeStandalonePdfSelection,
  standalonePdfSelectionFragments,
  type StandalonePdfSelectionItem,
  type StandalonePdfSelectionPage,
} from "../src/preview/standalonePdfSelection";

function pages(...entries: Array<[number, StandalonePdfSelectionItem[]]>): Map<number, StandalonePdfSelectionPage> {
  return new Map(entries.map(([pageNo, textItems]) => [pageNo, { textItems }]));
}

test("standalone PDF selection hit-tests the nearest logical geometry unit", () => {
  const items: StandalonePdfSelectionItem[] = [{
    text: "abcdef",
    hasEOL: false,
    baselineY: 20,
    height: 10,
    searchGeometry: [
      { from: 0, to: 3, left: 10, top: 10, width: 30, height: 10 },
      { from: 3, to: 6, left: 50, top: 10, width: 30, height: 10 },
    ],
  }];

  expect(hitTestStandalonePdfSelection(4, items, 66, 15)).toEqual({
    pageNo: 4,
    itemIndex: 0,
    geometryIndex: 1,
  });
  expect(hitTestStandalonePdfSelection(4, items, 120, 15, 4)).toBeNull();
});

test("standalone PDF selection keeps a multi-codepoint Khmer unit atomic", () => {
  const text = "ភាសា";
  const documentPages = pages([1, [{
    text,
    hasEOL: false,
    baselineY: 20,
    height: 10,
    searchGeometry: [
      { from: 0, to: text.length, left: 10, top: 10, width: 45, height: 10 },
    ],
  }]]);
  const endpoint = { pageNo: 1, itemIndex: 0, geometryIndex: 0 };

  expect(standalonePdfSelectionFragments(documentPages, endpoint, endpoint)).toEqual([{
    pageNo: 1,
    itemIndex: 0,
    from: 0,
    to: text.length,
  }]);
  expect(serializeStandalonePdfSelection(documentPages, endpoint, endpoint)).toBe(text);
});

test("standalone PDF selection serializes reverse drags in document order", () => {
  const documentPages = pages([1, [{
    text: "one two three",
    hasEOL: false,
    baselineY: 20,
    height: 10,
    searchGeometry: [
      { from: 0, to: 3, left: 10, top: 10, width: 20, height: 10 },
      { from: 3, to: 7, left: 30, top: 10, width: 30, height: 10 },
      { from: 7, to: 13, left: 60, top: 10, width: 35, height: 10 },
    ],
  }]]);
  const first = { pageNo: 1, itemIndex: 0, geometryIndex: 0 };
  const last = { pageNo: 1, itemIndex: 0, geometryIndex: 2 };

  expect(serializeStandalonePdfSelection(documentPages, last, first)).toBe("one two three");
});

test("standalone PDF selection joins visual line and page boundaries", () => {
  const documentPages = pages(
    [1, [
      {
        text: "first",
        hasEOL: false,
        baselineY: 20,
        height: 10,
        searchGeometry: [{ from: 0, to: 5, left: 10, top: 10, width: 30, height: 10 }],
      },
      {
        text: "second",
        hasEOL: false,
        baselineY: 33,
        height: 10,
        searchGeometry: [{ from: 0, to: 6, left: 10, top: 23, width: 40, height: 10 }],
      },
    ]],
    [2, [{
      text: "third",
      hasEOL: false,
      baselineY: 20,
      height: 10,
      searchGeometry: [{ from: 0, to: 5, left: 10, top: 10, width: 30, height: 10 }],
    }]],
  );

  expect(serializeStandalonePdfSelection(
    documentPages,
    { pageNo: 1, itemIndex: 0, geometryIndex: 0 },
    { pageNo: 2, itemIndex: 0, geometryIndex: 0 },
  )).toBe("first second third");
});

test("standalone PDF selection joins Khmer visual wraps without artificial spaces", () => {
  const documentPages = pages([1, [
    {
      text: "ពេល",
      hasEOL: true,
      baselineY: 20,
      height: 10,
      searchGeometry: [{ from: 0, to: 3, left: 10, top: 10, width: 30, height: 10 }],
    },
    {
      text: "នោះ",
      hasEOL: false,
      baselineY: 33,
      height: 10,
      searchGeometry: [{ from: 0, to: 3, left: 10, top: 23, width: 30, height: 10 }],
    },
  ]]);

  expect(serializeStandalonePdfSelection(
    documentPages,
    { pageNo: 1, itemIndex: 0, geometryIndex: 0 },
    { pageNo: 1, itemIndex: 1, geometryIndex: 0 },
  )).toBe("ពេលនោះ");
});

test("standalone PDF selection preserves geometry-separated paragraphs", () => {
  const documentPages = pages([1, [
    {
      text: "First paragraph.",
      hasEOL: true,
      baselineY: 20,
      height: 10,
      searchGeometry: [{ from: 0, to: 16, left: 10, top: 10, width: 80, height: 10 }],
    },
    {
      text: "Second paragraph.",
      hasEOL: false,
      baselineY: 42,
      height: 10,
      searchGeometry: [{ from: 0, to: 17, left: 10, top: 32, width: 90, height: 10 }],
    },
  ]]);

  expect(serializeStandalonePdfSelection(
    documentPages,
    { pageNo: 1, itemIndex: 0, geometryIndex: 0 },
    { pageNo: 1, itemIndex: 1, geometryIndex: 0 },
  )).toBe("First paragraph.\nSecond paragraph.");
});

test("standalone PDF selection learns normal line spacing before preserving a paragraph gap", () => {
  const textItems: StandalonePdfSelectionItem[] = [
    ["First visual line", 20],
    ["continues here.", 34],
    ["Second paragraph", 53],
    ["continues here.", 67],
  ].map(([text, baselineY]) => ({
    text: String(text),
    hasEOL: true,
    baselineY: Number(baselineY),
    height: 12,
    searchGeometry: [{
      from: 0,
      to: String(text).length,
      left: 10,
      top: Number(baselineY) - 10,
      width: 80,
      height: 12,
    }],
  }));
  const documentPages = pages([1, textItems]);

  expect(serializeStandalonePdfSelection(
    documentPages,
    { pageNo: 1, itemIndex: 0, geometryIndex: 0 },
    { pageNo: 1, itemIndex: 3, geometryIndex: 0 },
  )).toBe("First visual line continues here.\nSecond paragraph continues here.");
});

test("standalone PDF selection preserves an indented paragraph without extra leading", () => {
  const documentPages = pages([1, [
    {
      text: "Paragraph one ends.",
      hasEOL: true,
      baselineY: 20,
      height: 10,
      searchGeometry: [{ from: 0, to: 19, left: 10, top: 10, width: 90, height: 10 }],
    },
    {
      text: "Paragraph two begins",
      hasEOL: false,
      baselineY: 33,
      height: 10,
      searchGeometry: [{ from: 0, to: 20, left: 20, top: 23, width: 90, height: 10 }],
    },
  ]]);

  expect(serializeStandalonePdfSelection(
    documentPages,
    { pageNo: 1, itemIndex: 0, geometryIndex: 0 },
    { pageNo: 1, itemIndex: 1, geometryIndex: 0 },
  )).toBe("Paragraph one ends.\nParagraph two begins");
});

test("standalone PDF selection joins visual lines in the same tagged paragraph", () => {
  const documentPages = pages([1, [
    {
      text: "Tagged paragraph",
      hasEOL: true,
      baselineY: 20,
      height: 10,
      semanticBlockId: 7,
      searchGeometry: [{ from: 0, to: 16, left: 10, top: 10, width: 80, height: 10 }],
    },
    {
      text: "continues after a large visual gap.",
      hasEOL: false,
      baselineY: 60,
      height: 10,
      semanticBlockId: 7,
      searchGeometry: [{ from: 0, to: 35, left: 10, top: 50, width: 140, height: 10 }],
    },
  ]]);

  expect(serializeStandalonePdfSelection(
    documentPages,
    { pageNo: 1, itemIndex: 0, geometryIndex: 0 },
    { pageNo: 1, itemIndex: 1, geometryIndex: 0 },
  )).toBe("Tagged paragraph continues after a large visual gap.");
});

test("standalone PDF selection preserves tagged paragraph boundaries", () => {
  const documentPages = pages([1, [
    {
      text: "First paragraph.",
      hasEOL: true,
      baselineY: 20,
      height: 10,
      semanticBlockId: 7,
      searchGeometry: [{ from: 0, to: 16, left: 10, top: 10, width: 80, height: 10 }],
    },
    {
      text: "Second paragraph.",
      hasEOL: false,
      baselineY: 33,
      height: 10,
      semanticBlockId: 8,
      searchGeometry: [{ from: 0, to: 17, left: 10, top: 23, width: 90, height: 10 }],
    },
  ]]);

  expect(serializeStandalonePdfSelection(
    documentPages,
    { pageNo: 1, itemIndex: 0, geometryIndex: 0 },
    { pageNo: 1, itemIndex: 1, geometryIndex: 0 },
  )).toBe("First paragraph.\nSecond paragraph.");
});

test("standalone PDF selection separates a heading while joining wrapped paragraph lines", () => {
  const documentPages = pages([1, [
    {
      text: "Story heading",
      hasEOL: true,
      baselineY: 20,
      height: 14,
      semanticBlockId: 10,
      searchGeometry: [{ from: 0, to: 13, left: 10, top: 6, width: 90, height: 14 }],
    },
    {
      text: "The first paragraph wraps",
      hasEOL: true,
      baselineY: 42,
      height: 10,
      semanticBlockId: 11,
      searchGeometry: [{ from: 0, to: 25, left: 10, top: 32, width: 130, height: 10 }],
    },
    {
      text: "onto another visual line.",
      hasEOL: true,
      baselineY: 55,
      height: 10,
      semanticBlockId: 11,
      searchGeometry: [{ from: 0, to: 25, left: 10, top: 45, width: 125, height: 10 }],
    },
    {
      text: "The second paragraph starts here.",
      hasEOL: false,
      baselineY: 78,
      height: 10,
      semanticBlockId: 12,
      searchGeometry: [{ from: 0, to: 33, left: 10, top: 68, width: 160, height: 10 }],
    },
  ]]);

  expect(serializeStandalonePdfSelection(
    documentPages,
    { pageNo: 1, itemIndex: 0, geometryIndex: 0 },
    { pageNo: 1, itemIndex: 3, geometryIndex: 0 },
  )).toBe(
    "Story heading\nThe first paragraph wraps onto another visual line.\nThe second paragraph starts here.",
  );
});

test("standalone PDF selection keeps a tagged paragraph continuous across pages", () => {
  const documentPages = pages(
    [1, [{
      text: "Paragraph crosses",
      hasEOL: true,
      baselineY: 20,
      height: 10,
      semanticBlockId: 9,
      searchGeometry: [{ from: 0, to: 17, left: 10, top: 10, width: 80, height: 10 }],
    }]],
    [2, [{
      text: "the page boundary.",
      hasEOL: false,
      baselineY: 20,
      height: 10,
      semanticBlockId: 9,
      searchGeometry: [{ from: 0, to: 18, left: 10, top: 10, width: 90, height: 10 }],
    }]],
  );

  expect(serializeStandalonePdfSelection(
    documentPages,
    { pageNo: 1, itemIndex: 0, geometryIndex: 0 },
    { pageNo: 2, itemIndex: 0, geometryIndex: 0 },
  )).toBe("Paragraph crosses the page boundary.");
});
