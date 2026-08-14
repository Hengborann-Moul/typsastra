import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const previewSource = readFileSync("src/preview/previewFrame.ts", "utf8");
const viteSource = readFileSync("vite.config.ts", "utf8");

describe("PDF.js decoder assets", () => {
  test("configures the decoder directory for PDF loading", () => {
    expect(previewSource).toContain('wasmUrl: "/pdfjs-wasm/"');
    expect(previewSource).toContain("useWorkerFetch: false");
  });

  test("serves decoder assets in development and emits them in builds", () => {
    expect(viteSource).toContain('resolve("node_modules/pdfjs-dist/wasm")');
    expect(viteSource).toContain("configureServer(server)");
    expect(viteSource).toContain('fileName: `pdfjs-wasm/${assetName}`');
  });
});
