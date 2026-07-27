import { describe, expect, test } from "bun:test";

describe("preview dock layout", () => {
  test("keeps the docked split separate from the temporary undocked width", async () => {
    const layout = await Bun.file(new URL("../src/layout/layoutController.ts", import.meta.url)).text();
    const app = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();

    expect(layout).toContain("private dockedInputWidthPct = 50");
    expect(layout).toContain("this.captureDockedPaneSize();\n      previewWrapper.style.display = \"none\"");
    expect(layout).toContain("input.style.width = `${this.dockedInputWidthPct}%`");
    expect(layout).toContain("previewWrapper.style.width = `${100 - this.dockedInputWidthPct}%`");
    expect(app).toContain("inputContainerWidthPct: this.layoutController.getDockedInputWidthPct()");
    expect(app).toContain("this.layoutController.setDockedInputWidthPct(state.layout.inputContainerWidthPct)");
  });
});
