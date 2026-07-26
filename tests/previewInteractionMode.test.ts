import { describe, expect, test } from "bun:test";
import { previewAllowsInverseSync } from "../src/preview/previewInteractionMode";

describe("PDF preview interaction mode", () => {
  test("allows inverse sync for compiler-owned previews", () => {
    expect(previewAllowsInverseSync("source-synced")).toBe(true);
  });

  test("disables inverse sync for explicitly opened PDFs", () => {
    expect(previewAllowsInverseSync("standalone")).toBe(false);
  });
});
