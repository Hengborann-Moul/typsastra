import { describe, expect, test } from "bun:test";
import { applyDarkPreviewPixels } from "../src/preview/darkPreview";

describe("dark preview pixel mapping", () => {
  test("maps a white page to dark and black text to light", () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);

    applyDarkPreviewPixels(pixels);

    expect([...pixels]).toEqual([
      27, 27, 27, 255,
      235, 235, 235, 255,
    ]);
  });

  test("retains color direction instead of producing a grayscale page", () => {
    const pixels = new Uint8ClampedArray([40, 90, 210, 255]);

    applyDarkPreviewPixels(pixels);

    expect(pixels[2]).toBeGreaterThan(pixels[1]);
    expect(pixels[1]).toBeGreaterThan(pixels[0]);
  });

  test("leaves transparent pixels untouched", () => {
    const pixels = new Uint8ClampedArray([255, 255, 255, 0]);
    applyDarkPreviewPixels(pixels);
    expect([...pixels]).toEqual([255, 255, 255, 0]);
  });
});
