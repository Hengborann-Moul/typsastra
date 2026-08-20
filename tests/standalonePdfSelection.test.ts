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

test("standalone PDF selection preserves visual line and page boundaries", () => {
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
        baselineY: 40,
        height: 10,
        searchGeometry: [{ from: 0, to: 6, left: 10, top: 30, width: 40, height: 10 }],
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
  )).toBe("first\nsecond\nthird");
});
