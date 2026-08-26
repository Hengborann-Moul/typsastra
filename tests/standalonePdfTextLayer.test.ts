import { expect, test } from "bun:test";

const frameSource = await Bun.file("src/preview/previewFrame.ts").text();
const pdfiumSource = await Bun.file("src/preview/pdfiumDocument.ts").text();
const pdfPatch = await Bun.file("patches/pdfjs-dist@6.2.108.patch").text();

test("standalone PDFs render a logical text geometry layer", () => {
  expect(frameSource).toContain('dataset.previewSurface !== "pdf"');
  expect(frameSource).toContain("page.getTextContent({");
  expect(frameSource).toContain("disableNormalization: true");
  expect(frameSource).toContain("preserveLogicalText: true");
  expect(frameSource).toContain("normalizePdfLogicalTextContent(await page.getTextContent({");
  expect(frameSource).toContain('import("pdfjs-dist/build/pdf.worker.mjs?url")');
  expect(frameSource).not.toContain('import("pdfjs-dist/build/pdf.worker.min.mjs?url")');
  expect(frameSource).toContain("new pdfjs.TextLayer({");
  expect(frameSource).toContain('container.className = "pdf-text-layer"');
  expect(frameSource).toContain('"--total-scale-factor"');
  expect(frameSource).toContain("max-width:100%;max-height:100%;overflow:clip;contain:layout paint");
});

test("standalone PDFium pages keep a sharp backing raster at fractional zoom", () => {
  expect(frameSource).toContain("const MIN_PDFIUM_OUTPUT_SCALE = 2");
  expect(frameSource).toContain("Math.ceil(renderViewport.width)");
  expect(frameSource).toContain("Math.ceil(renderViewport.height)");
  expect(frameSource).toContain("isPdfiumDocument(this.pdfDoc)");
  expect(pdfiumSource).toContain("width: Math.max(1, Math.min(65_535, canvas.width))");
  expect(pdfiumSource).toContain("height: Math.max(1, Math.min(65_535, canvas.height))");
});

test("zoom invalidates coordinate-sensitive PDF overlays before rerendering", () => {
  const invalidation = frameSource.indexOf("this.invalidateZoomSensitiveOverlays();");
  const relayout = frameSource.indexOf(
    "this.layoutPageSlots({ preserveExistingPages: true });",
    invalidation,
  );
  expect(invalidation).toBeGreaterThan(-1);
  expect(relayout).toBeGreaterThan(invalidation);
  expect(frameSource).toContain("this.standalonePdfTextLayers.clear();");
  expect(frameSource).toContain(
    '".pdf-text-layer,.annotation-link,.pdf-search-marker,.pdf-selection-layer,.forward-sync-ripple"',
  );
});

test("standalone text selection does not trigger source inverse sync", () => {
  expect(frameSource).toContain(
    'if (doc.documentElement.dataset.previewSurface === "pdf") return;',
  );
});

test("standalone PDF search uses geometry-only highlights instead of browser Find", () => {
  expect(frameSource).toContain("shouldOpenStandalonePdfSearch(event)");
  expect(frameSource).toContain('event.code === "KeyF"');
  expect(frameSource).not.toContain('event.key.toLowerCase() === "f"');
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
  expect(frameSource).toContain("findPdfTextMatches(items, query)");
  expect(frameSource).toContain("this.scheduleStandalonePdfSearch(input.value, 0)");
  expect(frameSource).toContain("searchGeometry: run.glyphs.map");
  expect(frameSource).toContain("if (!this.standalonePdfTextLayers.has(match.pageNo))");
  expect(frameSource).toContain("this.updateStandalonePdfCurrentMarkers(previousIndex)");
  expect(frameSource).toContain("this.scrollStandalonePdfViewport(targetTop");
  expect(frameSource).not.toContain('marker?.scrollIntoView({ block: "center"');
});

test("virtualized standalone PDF pages restore search markers after committing overlays", () => {
  const overlayCommit = frameSource.indexOf(
    "this.commitFinalCanvas(slot, canvas, textLayer ? [textLayer, ...annotationLinks] : annotationLinks);",
  );
  const markerRender = frameSource.indexOf(
    "this.renderStandalonePdfSearchMarkers(pageNo);",
    overlayCommit,
  );
  expect(overlayCommit).toBeGreaterThan(-1);
  expect(markerRender).toBeGreaterThan(overlayCommit);
});

test("standalone PDF drag selection scrolls beyond viewport edges", () => {
  expect(frameSource).toContain("doc.documentElement.setPointerCapture(event.pointerId)");
  expect(frameSource).toContain("const target = doc?.elementFromPoint(clientX, clientY)");
  expect(frameSource).not.toContain("knownTarget ?? doc?.elementFromPoint(clientX, clientY)");
  expect(frameSource).toContain("standalonePdfSelectionAutoScrollDelta(pointer.y, view.innerHeight)");
  expect(frameSource).toContain("currentView.scrollBy({ top: delta, behavior: \"auto\" })");
  expect(frameSource).toContain("this.updateStandalonePdfSelectionFocusAtClientPoint(clientX, clientY)");
  expect(frameSource).toContain("releasePointerCapture(event.pointerId)");
  expect(frameSource).toContain("this.stopStandalonePdfSelectionAutoScroll()");
});

test("overlapping standalone PDF selection boxes share one tint", () => {
  expect(frameSource).toContain(
    ".pdf-selection-layer{position:absolute;inset:0;z-index:3;overflow:hidden;opacity:.52;pointer-events:none}",
  );
  expect(frameSource).toContain(
    ".pdf-selection-marker{position:absolute;box-sizing:border-box;background:AccentColor;pointer-events:none}",
  );
  expect(frameSource).toContain('selectionLayer.className = "pdf-selection-layer"');
  expect(frameSource).toContain("selectionLayer.append(marker)");
  expect(frameSource).not.toContain(
    ".pdf-selection-marker{position:absolute;z-index:3;box-sizing:border-box;background:color-mix",
  );
});

test("standalone PDF Ctrl or Cmd+A selects every logical page", () => {
  expect(frameSource).toContain('event.code === "KeyA"');
  expect(frameSource).toContain("if (!event.repeat) void this.selectAllStandalonePdfText()");
  expect(frameSource).toContain("isPdfiumDocument(this.pdfDoc)");
  expect(frameSource).toContain("!keyTarget?.closest(\"input,textarea,[contenteditable]\")");
  expect(frameSource).toContain("for (let pageNo = 1; pageNo <= pdfDoc.numPages; pageNo += 1)");
  expect(frameSource).toContain("const runs = await page.getPdfiumTextRuns()");
  expect(frameSource).toContain("standalonePdfSelectionDocumentEndpoints(pages)");
  expect(frameSource).toContain("generation !== this.standalonePdfSelectionGeneration");
  expect(frameSource).toContain("this.standalonePdfSelectionOwnsCompleteDocument = true");
  expect(frameSource).toContain("private standalonePdfKeyboardActive = false");
  expect(frameSource).toContain("if (!this.standalonePdfKeyboardActive)");
  expect(frameSource).toContain("if (this.standalonePdfSelectionAnchor) this.clearStandalonePdfSelection()");
  expect(frameSource.match(/window\.getSelection\(\)\?\.removeAllRanges\(\)/g)?.length).toBe(3);
  expect(frameSource).toContain("serializeStandalonePdfSelection(");
  expect(frameSource).toContain("this.standalonePdfSelectionPages");
});

test("standalone PDF copy serializes logical text items instead of positioned DOM text", () => {
  expect(frameSource).toContain('doc.addEventListener("copy"');
  expect(frameSource).toContain("this.standalonePdfSelectionText()");
  expect(frameSource).toContain('event.clipboardData?.setData("text/plain", text)');
  expect(frameSource).toContain('event.code === "KeyC"');
  expect(frameSource).toContain("this.copyStandalonePdfSelection()");
  expect(frameSource).toContain("doc.body.focus({ preventScroll: true })");
  expect(frameSource).not.toContain("this.standalonePdfSelectionRetainClick = false;\n    this.renderAllStandalonePdfSelectionMarkers();");
  expect(frameSource).toContain("hitTestStandalonePdfSelection(");
  expect(frameSource).toContain("standalonePdfSelectionFragments(");
  expect(frameSource).toContain('marker.className = "pdf-selection-marker"');
  expect(frameSource).toContain(".pdfium-text-layer :is(span,br){-webkit-user-select:none;user-select:none}");
  expect(frameSource).toContain(".pdf-text-layer:not(.pdfium-text-layer) ::selection");
  expect(frameSource).not.toContain("serializeStandalonePdfSelection(doc.getSelection())");
});

test("standalone PDF selections expose the logical text through the app context menu", async () => {
  const contextMenuSource = await Bun.file("src/components/contextMenuController.ts").text();
  expect(frameSource).toContain('type: "SHOW_PREVIEW_CONTEXT_MENU"');
  expect(frameSource).toContain("selectedText,");
  expect(contextMenuSource).toContain('id="ctx-preview-copy-selection"');
  expect(contextMenuSource).toContain("await writeText(this.previewSelectionText)");
  expect(contextMenuSource).toContain('id="ctx-preview-copy-selection-formatted"');
  expect(contextMenuSource).toContain('await invoke("write_formatted_clipboard"');
  expect(frameSource).toContain("serializeStandalonePdfFormattedSelection(");
  expect(frameSource).toContain("selectedHtml: formattedSelection?.html");
  expect(contextMenuSource).toContain("frameRect.left + data.x");
  expect(contextMenuSource).toContain("frameRect.top + data.y");
});

test("PDFium text lines use untransformed cursor hit areas", () => {
  expect(frameSource).toContain('hitArea.className = "pdfium-text-hit-area"');
  expect(frameSource).toContain("container.append(hitArea)");
  expect(frameSource).toContain(".pdf-text-layer>.pdfium-text-hit-area");
  expect(frameSource).toContain("display:block;cursor:text");
  expect(frameSource).toContain("transform:scaleX(var(--pdfium-scale-x))!important;pointer-events:none");
});

test("the pinned PDF.js worker preserves logical Unicode text", () => {
  expect(pdfPatch).toContain("diff --git a/legacy/build/pdf.worker.mjs");
  expect(pdfPatch).toContain("preserveLogicalText ? text : bidiResult.str");
  expect(pdfPatch).toContain("!disableNormalization && !preserveLogicalText");
  expect(pdfPatch).toContain("isolateLogicalGlyph");
  expect(pdfPatch.match(/Enhanced Unicode PDFs encode real spaces explicitly/g)?.length).toBe(4);
});
