import { describe, expect, test } from "bun:test";
import { imagePreviewFitScale } from "../src/preview/imagePreviewController";

describe("image preview fit scaling", () => {
  test("refits large images when the preview pane changes size", () => {
    expect(imagePreviewFitScale(800, 600, 1_600, 1_200)).toBe(0.5);
    expect(imagePreviewFitScale(1_200, 900, 1_600, 1_200)).toBe(0.75);
  });

  test("allows small images to fill the pane like fit-to-width PDF pages", () => {
    expect(imagePreviewFitScale(800, 600, 400, 300)).toBe(2);
  });

  test("waits for usable pane and image dimensions", () => {
    expect(imagePreviewFitScale(0, 600, 400, 300)).toBeNull();
    expect(imagePreviewFitScale(800, 600, 0, 300)).toBeNull();
  });
});
