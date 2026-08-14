import { describe, expect, test } from "bun:test";
import {
  capturePreviewViewportAnchor,
  previewViewportAnchorDelta,
} from "../src/preview/previewViewportAnchor";

describe("preview zoom viewport anchoring", () => {
  test("keeps the document point at the viewport center after zoom", () => {
    const anchor = capturePreviewViewportAnchor([
      { pageNo: 4, left: 100, top: -400, width: 600, height: 1_000 },
    ], 800, 600);
    expect(anchor).not.toBeNull();
    expect(anchor?.pageNo).toBe(4);
    expect(anchor?.pageYRatio).toBeCloseTo(0.7);

    const delta = previewViewportAnchorDelta(anchor!, {
      pageNo: 4,
      left: 25,
      top: -400,
      width: 750,
      height: 1_250,
    }, 800, 600);
    expect(delta.left).toBeCloseTo(0);
    expect(delta.top).toBeCloseTo(175);
  });

  test("anchors the page nearest the viewport center instead of the first visible page", () => {
    const anchor = capturePreviewViewportAnchor([
      { pageNo: 1, left: 100, top: -700, width: 600, height: 800 },
      { pageNo: 2, left: 100, top: 120, width: 600, height: 800 },
    ], 800, 600);
    expect(anchor?.pageNo).toBe(2);
    expect(anchor?.pageYRatio).toBeCloseTo(0.225);
  });
});
