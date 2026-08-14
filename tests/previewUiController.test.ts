import { describe, expect, test } from "bun:test";

describe("preview UI controller", () => {
  test("owns preview page, zoom, toolbar, and interaction-status UI without an untyped host", async () => {
    const source = await Bun.file(
      new URL("../src/preview/previewUiController.ts", import.meta.url),
    ).text();

    expect(source).toContain("export interface PreviewUiDependencies");
    expect(source).toContain("private pageStatusValue: PreviewPageStatus");
    expect(source).toContain("public initializePageControls()");
    expect(source).toContain("public updateActionsToolbar(");
    expect(source).toContain("public reportInteractionStatus(");
    expect(source).toContain("if (showTypstOnly || isPdf) menuBtn.classList.remove");
    expect(source).not.toContain(": any");
    expect(source).not.toContain("host: object");
    expect(source).not.toContain("new Proxy(");
  });

  test("keeps appController preview UI methods as delegates", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();

    expect(source).toContain("new PreviewUiController({");
    expect(source).toContain("this.previewUiController.updateZoomLabel(zoomPercent);");
    expect(source).toContain("this.previewUiController.updatePageStatus(status);");
    expect(source).toContain("this.previewUiController.updateActionsToolbar(path);");
    expect(source).toContain("this.previewUiController.reportInteractionStatus(status);");
  });
});
