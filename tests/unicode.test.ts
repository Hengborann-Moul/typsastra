import { describe, expect, it } from "vitest";
import { unicodeGraphemeBoundaries } from "../src/editor/editingPolicies/unicode.ts";

describe("unicodeGraphemeBoundaries", () => {
  it("treats ZWSP as an individual grapheme", () => {
    expect(unicodeGraphemeBoundaries("A\u200BB")).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 }
    ]);
  });

  it("keeps ZWNJ attached to the preceding grapheme", () => {
    expect(unicodeGraphemeBoundaries("A\u200CB")).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 3 }
    ]);
  });
});