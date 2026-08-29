import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (...parts: string[]): string => readFileSync(join(root, ...parts), "utf8");

const html = read("index.html");
const app = read("src", "appController.ts");
const bindings = read("src", "ui", "appEventBindings.ts");
const contextMenu = read("src", "components", "contextMenuController.ts");
const icons = read("src", "ui", "icons.ts");
const sourceNavigation = read("src", "preview", "previewSourceNavigationController.ts");
const toolbar = read("src", "editor", "toolbarController.ts");

function methodBody(source: string, startToken: string, endToken: string): string {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("preview toolbar actions", () => {
  test("places reveal cursor in the editor toolbar with a crosshair icon", () => {
    expect(html).toContain('data-tool="reveal-cursor-preview"');
    expect(html).toContain('title="Reveal Cursor in Preview (Alt+Enter)"');
    expect(html).not.toContain('id="preview-forward-sync-btn"');
    expect(icons).toContain('"reveal-cursor-preview": "crosshair"');
    expect(toolbar).toContain('case "reveal-cursor-preview":');
    expect(toolbar).toContain("this.dependencies.revealCursorInPreview()");
    expect(app).toContain("revealCursorInPreview: () => this.revealCursorInPreviewManually()");
    expect(sourceNavigation).toContain("'[data-tool=\"reveal-cursor-preview\"]'");
    expect(contextMenu).not.toContain('id="ctx-preview-forward-sync"');
  });

  test("recompile restarts Tinymist and restores the preview viewport", () => {
    const recompile = methodBody(
      app,
      "private async recompilePreviewManually()",
      "private schedulePdfPreview",
    );
    const captureAnchor = recompile.indexOf("const viewportAnchor = this.previewFrame.currentViewportAnchor");
    const captureScroll = recompile.indexOf("const scrollTop = this.previewFrame.currentScrollTop");
    const invalidate = recompile.indexOf('this.invalidatePreviewWork("manual recompile is restarting Tinymist")');
    const restart = recompile.indexOf('await this.restartTinymistSession("Restarting Tinymist and recompiling preview...")');
    const sessionGuard = recompile.indexOf("const samePreviewSession = filePathKey(this.activeFilePath");
    const queueAnchor = recompile.indexOf("this.previewFrame.queueViewportAnchor(viewportAnchor)");
    const queueScroll = recompile.indexOf("this.previewFrame.queueTabScrollPosition(scrollTop)");
    const restore = recompile.indexOf("await this.restoreActiveDocumentAfterTinymistRestart(true)");

    expect(captureAnchor).toBeGreaterThan(-1);
    expect(captureScroll).toBeGreaterThan(captureAnchor);
    expect(invalidate).toBeGreaterThan(captureScroll);
    expect(restart).toBeGreaterThan(invalidate);
    expect(sessionGuard).toBeGreaterThan(restart);
    expect(queueAnchor).toBeGreaterThan(sessionGuard);
    expect(queueScroll).toBeGreaterThan(queueAnchor);
    expect(restore).toBeGreaterThan(queueScroll);
    expect(recompile).not.toContain("pdfPreviewRenderController.recompileManually");
    expect(bindings).toContain(
      'document.getElementById("preview-recompile-btn")?.addEventListener("click", () => void actions.recompilePreview())',
    );
  });
});
