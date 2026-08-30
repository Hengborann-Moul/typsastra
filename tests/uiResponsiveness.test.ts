import { describe, expect, test } from "bun:test";

describe("UI responsiveness safeguards", () => {
  test("does not restyle every descendant when pane resizing begins", async () => {
    const css = await Bun.file(new URL("../src/style.css", import.meta.url)).text();
    expect(css).not.toContain("body.typsastra-resizing *");
    expect(css).toContain("body.typsastra-resizing::before");
  });

  test("coalesces compiler-driven log rendering and skips hidden console DOM work", async () => {
    const source = await Bun.file(
      new URL("../src/diagnostics/logConsoleController.ts", import.meta.url),
    ).text();
    expect(source).toContain("if (!this.visible || this.renderFrame !== null) return");
    expect(source).toContain("requestAnimationFrame");
  });

  test("defers retired PDF cleanup until the UI is idle and no resize is active", async () => {
    const source = await Bun.file(new URL("../src/preview/previewFrame.ts", import.meta.url)).text();
    expect(source).toContain("await waitForUiIdle()");
    expect(source).toContain("while (this.resizeLayoutSuspended)");
  });

  test("keeps PDF presentation and source-map warm-up out of active pane drags", async () => {
    const appSource = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const source = await Bun.file(
      new URL("../src/preview/pdfPreviewRenderController.ts", import.meta.url),
    ).text();
    const previewSyncSource = await Bun.file(
      new URL("../src/preview/previewSyncController.ts", import.meta.url),
    ).text();
    const compileComplete = source.indexOf("Tinymist mirror-root PDF compile complete.");
    const resizeBoundary = source.indexOf("await this.deps.workspaceResume.waitForHorizontalResizeEnd()", compileComplete);
    const presentation = source.indexOf("await this.loadPdfPath(", resizeBoundary);
    expect(compileComplete).toBeGreaterThan(-1);
    expect(resizeBoundary).toBeGreaterThan(compileComplete);
    expect(presentation).toBeGreaterThan(resizeBoundary);
    expect(appSource).toContain("interactionBlocked: this.workspaceResumeController.interactionBlocked");
    expect(previewSyncSource).toContain(
      "context.interactionBlocked || context.previewRunning || !ready",
    );
    expect(source).toContain("this.deps.scheduleSourceMapWarmup(generation)");
  });

  test("recovers an interrupted pane drag and stale source-map socket after system resume", async () => {
    const appSource = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const resumeSource = await Bun.file(
      new URL("../src/platform/workspaceResumeController.ts", import.meta.url),
    ).text();
    const layoutSource = await Bun.file(new URL("../src/layout/layoutController.ts", import.meta.url)).text();
    expect(appSource).toContain("this.workspaceResumeController.recoverAfterSystemResume(suspendedMs)");
    expect(appSource).toContain("recoverInterruptedResize: () => this.layoutController.recoverInterruptedResize()");
    expect(appSource).toContain("await this.editorFontManager.ready()");
    expect(appSource).toContain("this.previewFrame.syncTheme()");
    expect(resumeSource).toContain('this.deps.remeasureWorkspace("system resume settling")');
    expect(resumeSource).toContain('document.body.classList.add("typsastra-resume-recovering")');
    expect(resumeSource).toContain('document.body.classList.remove("typsastra-resume-recovering")');
    expect(layoutSource).toContain("recoverInterruptedResize");
    expect(layoutSource).toContain('document.body.classList.remove("typsastra-resizing")');
  });

  test("does not sample memory or build an unbounded promise chain for no-op file events", async () => {
    const appSource = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const workspaceSource = await Bun.file(
      new URL("../src/workspace/workspaceController.ts", import.meta.url),
    ).text();
    expect(appSource).not.toContain('logMemoryDiagnostics("workspace watcher: self-save suppressed")');
    expect(workspaceSource).not.toContain("workspaceChangeQueue");
    expect(workspaceSource).toContain("pendingChanges = new Map");
    expect(workspaceSource).toContain("pending.paths = [...new Set([...pending.paths, ...change.paths])]");
  });
});
