import { describe, expect, test } from "bun:test";
import { tabStripWheelDelta } from "../src/editor/tabStripController";

describe("editor tab strip scrolling", () => {
  test("translates a mouse wheel into horizontal tab movement", () => {
    expect(tabStripWheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800)).toBe(48);
    expect(tabStripWheelDelta({ deltaX: 0, deltaY: -2, deltaMode: 1 }, 800)).toBe(-32);
  });

  test("preserves the dominant horizontal trackpad gesture", () => {
    expect(tabStripWheelDelta({ deltaX: 24, deltaY: 5, deltaMode: 0 }, 800)).toBe(24);
    expect(tabStripWheelDelta({ deltaX: -18, deltaY: -4, deltaMode: 0 }, 800)).toBe(-18);
  });

  test("normalizes page-mode wheel events to the visible strip width", () => {
    expect(tabStripWheelDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 640)).toBe(640);
  });
});
