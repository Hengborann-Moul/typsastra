import { describe, expect, test } from "bun:test";

describe("PDF preview render controller", () => {
  test("owns render scheduling and transport state behind an explicit dependency interface", async () => {
    const source = await Bun.file(
      new URL("../src/preview/pdfPreviewRenderController.ts", import.meta.url),
    ).text();

    expect(source).toContain("export interface PdfPreviewRenderDependencies");
    expect(source).toContain("private generationValue = 0");
    expect(source).toContain("private scheduleGeneration = 0");
    expect(source).toContain("private queuedContents: string | null = null");
    expect(source).toContain("public async render(contents: string, force = false)");
    expect(source).toContain("public schedule(contents: string, delayMs: number)");
    expect(source).toContain("public async loadPdfPath(");
    expect(source).toContain('surface === "pdf"');
    expect(source).toContain('setLoading("Preparing PDF preview…", false)');
    expect(source).toContain('setLoading("Compiling live preview…")');
    expect(source).toContain("public resetForWorkspaceClose(): void");
    expect(source).not.toContain(": any");
    expect(source).not.toContain("host: object");
    expect(source).not.toContain("new Proxy(");
  });

  test("keeps appController as a thin delegate for render, load, schedule, and invalidation", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();

    expect(source).toContain("new PdfPreviewRenderController({");
    expect(source).toContain("return this.pdfPreviewRenderController.render(contents, force);");
    expect(source).toContain("return this.pdfPreviewRenderController.loadPdfPath(");
    expect(source).toContain("this.pdfPreviewRenderController.schedule(contents, delayMs);");
    expect(source).toContain("this.pdfPreviewRenderController.invalidate(reason);");
    expect(source).not.toContain("private pdfPreviewTimer");
    expect(source).not.toContain("private queuedPdfPreviewContents");
  });

  test("resets controller-owned preview state when a workspace closes", async () => {
    const lifecycle = await Bun.file(
      new URL("../src/workspace/workspaceLifecycleController.ts", import.meta.url),
    ).text();

    expect(lifecycle).toContain("app.pdfPreviewRenderController.resetForWorkspaceClose();");
    expect(lifecycle).toContain("app.pdfPreviewPreparationController.clearGeneratedFiles();");
    expect(lifecycle).not.toContain("app.pdfPreviewGeneration += 1");
    expect(lifecycle).not.toContain("app.pdfPreviewSourceMapRootPath = null");
    expect(lifecycle).not.toContain('app.lastPdfPath = ""');
  });
});
