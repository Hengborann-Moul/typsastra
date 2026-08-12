import { describe, expect, test } from "bun:test";
import { isTinymistStoppedRequestError } from "../src/compiler/lsp";

describe("Tinymist workspace lifecycle", () => {
  test("exposes an explicit native process stop boundary", async () => {
    const nativeSource = await Bun.file(new URL("../src-tauri/src/lib.rs", import.meta.url)).text();
    const transportSource = await Bun.file(new URL("../src/compiler/lspTransport.ts", import.meta.url)).text();
    const clientSource = await Bun.file(new URL("../src/compiler/lsp.ts", import.meta.url)).text();

    expect(nativeSource).toContain("async fn stop_tinymist_lsp");
    expect(nativeSource).toContain("stop_lsp_process(&state).await");
    expect(transportSource).toContain('invoke("stop_tinymist_lsp")');
    expect(clientSource).toContain("public async stop(): Promise<void>");
  });

  test("restarts for main-file changes and stops when a project closes", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const lifecycle = await Bun.file(
      new URL("../src/workspace/workspaceLifecycleController.ts", import.meta.url),
    ).text();
    const sessionSource = await Bun.file(
      new URL("../src/session/documentSessionController.ts", import.meta.url),
    ).text();
    const typographySource = await Bun.file(
      new URL("../src/typography/typographyController.ts", import.meta.url),
    ).text();

    expect(source).toContain("mainChanged && this.lspClient");
    expect(source).toContain("preparePinnedMainTypography(path)");
    expect(typographySource).toContain("scaled_workspace_font_set_status");
    expect(typographySource).toContain("activate_scaled_workspace_fonts");
    expect(typographySource).toContain("this.port.synchronizeDocumentTypography(config)");
    expect(source).toContain("ownsWorkspaceTypography && !await this.typographyController.confirmScaleRange(config)");
    expect(typographySource).toContain("if (!this.port.isPinnedMainFile(activeFilePath))");
    expect(source.indexOf("preparePinnedMainTypography(path)")).toBeLessThan(
      source.indexOf("this.pinnedMainFilePath = path", source.indexOf("preparePinnedMainTypography(path)"))
    );
    expect(source).toContain('restartTinymistSession("Restarting Tinymist for the new main file..."');
    expect(lifecycle).toContain('stopTinymistSession("Project closed")');
    expect(sessionSource).toContain("private lifecycleQueue: Promise<void>");
    expect(sessionSource).toContain("runExclusive(operation: () => Promise<void>)");
    const setMainStart = source.indexOf("private async setPinnedMainFile");
    const setMainEnd = source.indexOf("private async closeProject", setMainStart);
    const setMainSource = source.slice(setMainStart, setMainEnd);
    expect(setMainSource).toContain("this.blockedLargePreviewRoot = null");
    expect(setMainSource).toContain("await this.largePreviewNoticeForRoot(path)");
    expect(setMainSource).toContain("this.workspaceServicesDeferredForLargeFile = true");
    expect(setMainSource).toContain('stopTinymistSession("Large Typst file waiting for editor approval")');
    expect(source).toContain("private async restoreActiveDocumentAfterTinymistRestart");
    expect(source).toContain("if (mainChanged && (!path || mainWasAlreadyActive))");
    expect(source).toContain("await this.restoreActiveDocumentAfterTinymistRestart();");
  });

  test("continues opening a replacement after late teardown cleanup fails", async () => {
    const lifecycle = await Bun.file(
      new URL("../src/workspace/workspaceLifecycleController.ts", import.meta.url),
    ).text();

    expect(lifecycle).toContain("const previousWorkspace = app.workspaceRootPath;");
    expect(lifecycle).toContain("if (app.workspaceRootPath !== null) throw error;");
    expect(lifecycle).toContain("continuing with ${selected}");
    expect(lifecycle.indexOf("app.workspaceLoading = true;")).toBeGreaterThan(
      lifecycle.indexOf("if (app.workspaceRootPath !== null) throw error;"),
    );
  });

  test("reloads template typography and synchronizes restored directives", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const typographySource = await Bun.file(
      new URL("../src/typography/typographyController.ts", import.meta.url),
    ).text();
    const presentationSource = await Bun.file(
      new URL("../src/editor/editorTabPresentationController.ts", import.meta.url),
    ).text();
    expect(typographySource).toContain("public async reloadTemplateContext");
    expect(typographySource).toContain('this.port.restartTinymistSession("Reloading template typography...")');
    const presentation = presentationSource.indexOf("presentText(tab: EditorTab, path: string)");
    const tabDispatch = presentationSource.indexOf("editor.dispatch({", presentation);
    const activation = source.indexOf("private async activateEditorTab");
    const presentText = source.indexOf("this.editorTabPresentationController.presentText(tab, path)", activation);
    const activeTabCommit = source.indexOf("this.activeFilePath = path;", presentText);
    const typographyResolve = source.indexOf(
      "await this.typographyController.effective(path, tab.content)",
      activeTabCommit,
    );
    const typographySync = source.indexOf(
      "this.editorToolbarController.synchronizeDocumentTypography(activeTypography)",
      typographyResolve,
    );
    expect(tabDispatch).toBeGreaterThan(presentation);
    expect(presentText).toBeGreaterThan(activation);
    expect(activeTabCommit).toBeGreaterThan(presentText);
    expect(activeTabCommit).toBeLessThan(typographyResolve);
    expect(typographySync).toBeGreaterThan(typographyResolve);
  });

  test("keeps imported template ownership while reusing the main preview session", async () => {
    const source = await Bun.file(
      new URL("../src/preview/previewSessionController.ts", import.meta.url),
    ).text();
    const capture = source.indexOf("captureCurrentMainSessionForImportedTarget");
    const nextMethod = source.indexOf("\n  applySessionToTab", capture + 10);
    const method = source.slice(capture, nextMethod);
    expect(method).toContain("previewImported: target.imported");
    expect(method).toContain("previewStandalone: target.standalone");
    expect(method).toContain("previewDisabled: target.disabled");
  });

  test("uses one cached compiler root for on-save and on-type sessions", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const normalizedSource = source.replace(/\r\n/g, "\n");
    const preparationSource = await Bun.file(
      new URL("../src/preview/pdfPreviewPreparationController.ts", import.meta.url),
    ).text();
    const contentSource = await Bun.file(
      new URL("../src/preview/previewContentController.ts", import.meta.url),
    ).text();
    const preparation = preparationSource.indexOf("public async prepareProjectIfNeeded");
    const preparationEnd = preparationSource.indexOf("\n  public ", preparation + 10);
    const method = preparationSource.slice(preparation, preparationEnd);
    expect(method).toContain("const pinnedMainFilePath = this.deps.getPinnedMainFilePath()");
    expect(method).toContain("entryFile = this.deps.mapToOriginalPath(pinnedMainFilePath)");
    expect(method).not.toContain('renderMode !== "on-type"');
    expect(contentSource).toContain("await this.deps.updatePinnedMain(previewLspMainPath(target))");
    expect(source).not.toContain("cachedPreviewCompilerPath");
    expect(normalizedSource).toContain("await this.prepareRenderProjectIfNeeded();\n        await this.restartTinymistSession");
  });

  test("corrects unsupported compiler-font scales after reporting them", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const typographySource = await Bun.file(
      new URL("../src/typography/typographyController.ts", import.meta.url),
    ).text();
    expect(typographySource).toContain('this.port.dispatchDocumentEdit(edit, "input.typography-scale-correction")');
    expect(typographySource).toContain("this.resetUnsupportedInternalScales");
    expect(typographySource).toContain("Typsastra will reset their scale to 1×");
  });

  test("clears logs at user-requested lifecycle boundaries", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const eventBindings = await Bun.file(
      new URL("../src/ui/appEventBindings.ts", import.meta.url),
    ).text();
    const lifecycle = await Bun.file(
      new URL("../src/workspace/workspaceLifecycleController.ts", import.meta.url),
    ).text();
    const closeProject = lifecycle.indexOf("async close(");
    const closeClear = lifecycle.indexOf("app.logConsoleController.clearAllLogs();", closeProject);
    const closeConsole = lifecycle.indexOf("app.logConsoleController.setVisible(false);", closeProject);
    const manualRestart = eventBindings.indexOf('document.getElementById("action-restart-lsp")');
    const restartBinding = eventBindings.indexOf("actions.restartLsp()", manualRestart);
    const restartStart = source.indexOf("restartLsp: async () => {");
    const restartClear = source.indexOf("this.logConsoleController.clearAllLogs();", restartStart);
    const restartCall = source.indexOf('restartTinymistSession("Restarting LSP..."', restartStart);
    const restartRestore = source.indexOf(
      "await this.restoreActiveDocumentAfterTinymistRestart();",
      restartCall
    );
    const restartEnd = source.indexOf("},", restartRestore);
    expect(closeClear).toBeGreaterThan(closeProject);
    expect(closeConsole).toBeGreaterThan(closeClear);
    expect(closeConsole).toBeGreaterThan(closeProject);
    expect(manualRestart).toBeGreaterThan(-1);
    expect(restartBinding).toBeGreaterThan(manualRestart);
    expect(restartClear).toBeGreaterThan(restartStart);
    expect(restartClear).toBeLessThan(restartCall);
    expect(restartRestore).toBeGreaterThan(restartCall);
    expect(restartEnd).toBeGreaterThan(restartRestore);
    expect(source.slice(restartStart, restartEnd)).not.toContain("activateEditorTab");
  });

  test("restarts and requeues a preview interrupted by an unexpected Tinymist stop", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const clientSource = await Bun.file(new URL("../src/compiler/lsp.ts", import.meta.url)).text();
    const renderSource = await Bun.file(
      new URL("../src/preview/pdfPreviewRenderController.ts", import.meta.url),
    ).text();
    const sourceMapSource = await Bun.file(
      new URL("../src/preview/sourceMapSessionController.ts", import.meta.url),
    ).text();
    const previewSyncSource = await Bun.file(
      new URL("../src/preview/previewSyncController.ts", import.meta.url),
    ).text();

    expect(isTinymistStoppedRequestError(
      new Error("Tinymist stopped before the LSP request completed.")
    )).toBe(true);
    expect(isTinymistStoppedRequestError(new Error("Typst compilation failed."))).toBe(false);
    const recoverySource = await Bun.file(
      new URL("../src/preview/tinymistPreviewRecoveryController.ts", import.meta.url),
    ).text();
    expect(source).toContain("private recoverTinymistPreviewAfterUnexpectedStop");
    expect(recoverySource).toContain("this.attempts >= 1");
    expect(recoverySource).toContain('this.dependencies.restartTinymistSession("Recovering interrupted preview...")');
    expect(recoverySource).toContain("await this.dependencies.restoreActiveDocumentAfterRestart()");
    expect(recoverySource).toContain("this.dependencies.queueRecovery(contents)");
    expect(renderSource).toContain("this.queuedContents ??= contents");
    expect(renderSource).toContain("this.queuedForced = true");
    expect(renderSource).toContain("isTinymistStoppedRequestError(error)");
    expect(source).toContain("this.tinymistPreviewRecoveryController.resetAttempts()");
    expect(source).toContain("this.sourceMapSessionController.reset()");
    expect(sourceMapSource).toContain("this.retryKey = null");
    expect(source).toContain("this.previewSyncController.clearWarmup()");
    expect(previewSyncSource).toContain("window.clearTimeout(this.warmupTimer)");
    expect(source).toContain("this.pdfPreviewRenderController.resetSourceMapIdentity()");
    expect(renderSource).toContain("this.sourceMapRootPathValue = null");
    expect(renderSource).toContain("this.sourceMapTaskIdValue = null");
    expect(clientSource).toContain("private clearPreviewEndpoints(): void");
    expect(clientSource).toContain("this.latestPreviewDataPlaneUrl = \"\"");
  });
});
