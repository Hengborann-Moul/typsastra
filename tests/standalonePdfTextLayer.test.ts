import { expect, test } from "bun:test";

const frameSource = await Bun.file("src/preview/previewFrame.ts").text();
const pdfPatch = await Bun.file("patches/pdfjs-dist@6.2.108.patch").text();

test("standalone PDFs render a logical selectable text layer", () => {
  expect(frameSource).toContain('dataset.previewSurface !== "pdf"');
  expect(frameSource).toContain("page.streamTextContent({");
  expect(frameSource).toContain("disableNormalization: true");
  expect(frameSource).toContain("preserveLogicalText: true");
  expect(frameSource).toContain("new pdfjs.TextLayer({");
  expect(frameSource).toContain('container.className = "pdf-text-layer"');
  expect(frameSource).toContain('"--total-scale-factor"');
  expect(frameSource).toContain("max-width:100%;max-height:100%;overflow:clip;contain:layout paint");
});

test("standalone text selection does not trigger source inverse sync", () => {
  expect(frameSource).toContain(
    'if (doc.documentElement.dataset.previewSurface === "pdf") return;',
  );
});

test("standalone PDF search uses geometry-only highlights instead of browser Find", () => {
  expect(frameSource).toContain("shouldOpenStandalonePdfSearch(event)");
  expect(frameSource).toContain("event.preventDefault()");
  expect(frameSource).toContain('id="pdf-search-panel"');
  expect(frameSource).toContain('marker.className = `pdf-search-marker');
  expect(frameSource).toContain("range.getClientRects()");
  expect(frameSource).toContain("background:rgba(255,214,0,.52)");
  expect(frameSource).toContain("--preview-editor-line-height");
  expect(frameSource).toContain("pdf-search-input-shell");
  expect(frameSource).toContain("handlePreviewFindShortcut(event)");
  expect(frameSource).toContain("this.onEditorSearchRequest?.()");
  expect(frameSource).toContain("pdf-search-editor-caret");
  expect(frameSource).toContain('id="pdf-search-next"');
});

test("the pinned PDF.js worker preserves logical Unicode text", () => {
  expect(pdfPatch).toContain("preserveLogicalText ? text : bidiResult.str");
  expect(pdfPatch).toContain("!disableNormalization && !preserveLogicalText");
  expect(pdfPatch).toContain("isolateLogicalGlyph");
});
