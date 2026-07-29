import { describe, expect, test } from "bun:test";

describe("compiled PDF transport", () => {
  test("exports previews to a private cache instead of returning Base64 through LSP", async () => {
    const source = await Bun.file(new URL("../src/compiler/lsp.ts", import.meta.url)).text();
    expect(source).toContain('$root/.typsastra/cache/preview/$name');
    expect(source).not.toContain('cache/preview/$dir/$name');
    expect(source).toContain("outputPath: PREVIEW_OUTPUT_PATH");
    expect(source).toContain("arguments: [path, {}, { write: true, open: false }]");
    expect(source).not.toContain("exportPdfToMemory");
  });

  test("loads compiled previews through raw binary IPC without retaining Base64", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    expect(source).toContain('invoke<ArrayBuffer | Uint8Array | number[]>("read_binary_file"');
    expect(source).not.toContain("lastPdfBase64");
    expect(source).not.toContain("exportBase64Chars");
  });

  test("registers generated preview PDFs before Tinymist writes them", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const registration = source.indexOf("this.managedPreviewPdfPathKeys.add(anticipatedPdfPathKey)");
    const exportRequest = source.indexOf("await this.lspClient.exportPdfToFile(previewPath)");
    expect(registration).toBeGreaterThan(-1);
    expect(exportRequest).toBeGreaterThan(registration);
    expect(source).toContain('const anticipatedPdfPath = `${cacheRoot}/preview/${previewPdfName}`');
    expect(source).toContain("excludeManagedWorkspacePaths(");
  });

  test("uses the private render mirror for on-save and on-type previews", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    expect(source).toContain("Every live preview compiles from Typsastra's private render mirror.");
    expect(source).not.toContain('const shouldMirror = this.settingsController.value.preview.renderMode === "on-type"');
    expect(source).not.toContain("if (!shouldMirror || !this.workspaceRootPath)");
  });

  test("pins the exact prepared revision transiently while exporting in every render mode", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const renderStart = source.indexOf("private async renderPdfPreview");
    const preparedPaths = source.indexOf("const preparedPaths = [...new Set([", renderStart);
    const legacyClose = source.indexOf("await this.closePreparedPreviewDocuments()", preparedPaths);
    const invalidation = source.indexOf("await this.lspClient.notifyWorkspaceFilesChanged(", preparedPaths);
    const transientOpen = source.indexOf("await this.openPreparedPreviewDocumentsForExport(preparedPaths)", invalidation);
    const exportRequest = source.indexOf("await this.lspClient.exportPdfToFile(previewPath)", transientOpen);
    const transientClose = source.indexOf("await this.closePreparedPreviewDocuments()", exportRequest);
    const invalidationPrefix = source.slice(preparedPaths, invalidation);

    expect(preparedPaths).toBeGreaterThan(renderStart);
    expect(legacyClose).toBeGreaterThan(preparedPaths);
    expect(invalidation).toBeGreaterThan(legacyClose);
    expect(transientOpen).toBeGreaterThan(invalidation);
    expect(exportRequest).toBeGreaterThan(transientOpen);
    expect(transientClose).toBeGreaterThan(exportRequest);
    expect(invalidationPrefix).not.toContain('renderMode === "on-type"');
    expect(source).toContain("...preparedPreview.changedPaths");
    expect(source).toContain("changedPaths: result.changedFiles");
    expect(source).not.toContain("syncPreparedPreviewDocuments");
    expect(source).toContain("if (this.isRenderCachePath(rawPath))");
    expect(source).toContain("Tinymist's watched-file invalidation can complete");
  });

  test("uses memory overlays on type and disk snapshots on save", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    expect(source).toContain(
      'const useEditorOverlays = this.effectivePreviewRenderMode === "on-type" || force;'
    );
    expect(source).toContain("const tabsToOverlay = useEditorOverlays");
    expect(source).toMatch(
      /if\s*\(\s*useEditorOverlays\s*&&[\s\S]*?!overlaid\.has\(filePathKey\(originalActivePath\)\)/
    );
  });

  test("keeps editor diagnostics on original sources and recompiles explicit saves in either mode", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const saveStart = source.indexOf("private async performSaveActiveFile");
    const saveEnd = source.indexOf("\n  private ", saveStart + 10);
    const saveMethod = source.slice(saveStart, saveEnd);
    expect(source).toContain("await this.updatePinnedMain(previewLspMainPath(target))");
    expect(source).not.toContain("cachedPreviewCompilerPath");
    expect(source).toContain("if (this.isRenderCachePath(rawPath))");
    expect(saveMethod).toContain("void this.renderPdfPreview(content)");
    expect(saveMethod).not.toContain('effectivePreviewRenderMode === "on-save"');
  });

  test("recovers the latest editor snapshot after a failed on-type render", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const renderStart = source.indexOf("private async renderPdfPreview");
    const renderEnd = source.indexOf("\n  private ", renderStart + 10);
    const renderMethod = source.slice(renderStart, renderEnd);
    const diagnosticsStart = source.indexOf("private async handleLspDiagnostics");
    const diagnosticsEnd = source.indexOf("\n  private ", diagnosticsStart + 10);
    const diagnosticsMethod = source.slice(diagnosticsStart, diagnosticsEnd);

    expect(renderMethod).toContain("const latestContents = this.editorInstance.state.doc.toString()");
    expect(renderMethod).toContain("if (latestContents !== contents)");
    expect(renderMethod).toContain("queued !== contents || !renderSucceeded");
    expect(renderMethod).toContain('this.previewFrame.setError("Preview Render Failed", failureMessage)');
    expect(renderMethod).not.toContain("if (!this.previewFrame.currentUrl)");
    expect(renderMethod).not.toContain('if (reportRenderStatus) {\n        this.setLspStatus({ kind: "preview-ready", message: "Preview ready" });');
    expect(renderMethod).toContain('this.setLspStatus({ kind: "preview-ready", message: "Preview ready" });');
    expect(diagnosticsMethod).not.toContain('this.previewFrame.setError("Preview Render Failed"');
    expect(diagnosticsMethod).not.toContain("this.previewFrame.clearErrorOverlay()");
    expect(diagnosticsMethod).toContain("this.lastFailedPreviewContents !== null");
    expect(diagnosticsMethod).toContain("LSP accepted a corrected revision after preview failure");
    expect(source).toContain("function previewRenderErrorMessage(error: unknown)");
  });

  test("validates copied workspace caches before starting Tinymist", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const validation = source.indexOf(
      'await invoke("cleanup_workspace_preview_files", { workspaceRootPath: selected })'
    );
    const startup = source.indexOf(
      'await this.restartTinymistSession("Connecting to new project...")'
    );
    expect(validation).toBeGreaterThan(-1);
    expect(startup).toBeGreaterThan(validation);
  });

  test("requires explicit confirmation before writing a user-facing PDF", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const confirmation = source.indexOf('title: outputExists ? "Replace Exported PDF?" : "Export PDF?"');
    const workspaceCopy = source.indexOf('invoke("copy_workspace_file", { source: pdfPath, dest: originalPdfPath })');
    expect(confirmation).toBeGreaterThan(-1);
    expect(workspaceCopy).toBeGreaterThan(confirmation);
    expect(source).toContain('if (exportAction !== "export")');
  });
});
