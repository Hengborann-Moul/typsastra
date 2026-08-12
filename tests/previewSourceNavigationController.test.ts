import { describe, expect, test } from "bun:test";

describe("preview source navigation controller", () => {
  test("owns inverse sync, forward sync, and preview click routing through typed dependencies", async () => {
    const source = await Bun.file(
      new URL("../src/preview/previewSourceNavigationController.ts", import.meta.url),
    ).text();

    expect(source).toContain("export interface PreviewSourceNavigationDependencies");
    expect(source).toContain("public async handleInverseSync(");
    expect(source).toContain("public async forwardSyncTarget(");
    expect(source).toContain("public async handlePdfPreviewClick(");
    expect(source).toContain("private async applyInverseSyncSelection(");
    expect(source).not.toContain(": any");
    expect(source).not.toContain("host: object");
    expect(source).not.toContain("new Proxy(");
  });

  test("keeps existing appController method names as narrow delegates", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();

    expect(source).toContain("new PreviewSourceNavigationController({");
    expect(source).toContain("return this.previewSourceNavigationController.handleInverseSync(uri, position);");
    expect(source).toContain("return this.previewSourceNavigationController.forwardSyncTarget(path, cursor);");
    expect(source).toContain("return this.previewSourceNavigationController.handlePdfPreviewClick(point);");
  });
});
