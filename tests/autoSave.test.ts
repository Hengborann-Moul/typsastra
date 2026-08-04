import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const controller = readFileSync(new URL("../src/appController.ts", import.meta.url), "utf8");
const settingsUi = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("auto save", () => {
  test("exposes an enabled setting and bounded interval control", () => {
    expect(settingsUi).toContain('id="settings-auto-save"');
    expect(settingsUi).toContain('id="settings-auto-save-interval"');
    expect(settingsUi).toContain('min="5"');
    expect(settingsUi).toContain('max="300"');
  });

  test("automatic persistence does not notify Tinymist or render preview", () => {
    const start = controller.indexOf("private async performAutoSave");
    const end = controller.indexOf("private async saveActiveFileAs", start);
    const method = controller.slice(start, end);

    expect(method).toContain('invoke("save_workspace_file"');
    expect(method).not.toContain("notifyTextSave");
    expect(method).not.toContain("renderPdfPreview");
  });

  test("manual save renders even when auto-save already cleared the dirty state", () => {
    const start = controller.indexOf("private async performSaveActiveFile");
    const end = controller.indexOf("private async formatActiveDocument", start);
    const method = controller.slice(start, end);

    expect(method).toContain('intent === "manual"');
    expect(method).toContain("participatesInPreviewCompilation");
    expect(method).toContain("void this.renderPdfPreview(content)");
    expect(method).not.toContain("savedChangedRevision &&");
  });
});
