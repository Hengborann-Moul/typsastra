import { describe, expect, test } from "bun:test";
import {
  nextTextControlBoundary,
  previousTextControlBoundary,
  snapTextControlOffset,
} from "../src/ui/graphemeTextControl";

describe("global grapheme text-control policy", () => {
  test("keeps Khmer clusters intact in native text controls", () => {
    const text = "\u1781\u17D2\u1798\u17C2\u179A";

    expect(nextTextControlBoundary(text, 0)).toBe(4);
    expect(nextTextControlBoundary(text, 2)).toBe(4);
    expect(previousTextControlBoundary(text, 4)).toBe(0);
    expect(snapTextControlOffset(text, 2, "backward")).toBe(0);
    expect(snapTextControlOffset(text, 2, "forward")).toBe(4);
  });

  test("never places a native caret inside a surrogate pair or combining sequence", () => {
    expect(snapTextControlOffset("A😀B", 2, "backward")).toBe(1);
    expect(snapTextControlOffset("A😀B", 2, "forward")).toBe(3);

    const decomposed = "Cafe\u0301";
    expect(previousTextControlBoundary(decomposed, decomposed.length)).toBe(3);
    expect(snapTextControlOffset(decomposed, 4, "backward")).toBe(3);
    expect(snapTextControlOffset(decomposed, 4, "forward")).toBe(5);
  });
});
