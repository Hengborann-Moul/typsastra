import { describe, expect, test } from "bun:test";

describe("Markdown preview contracts", () => {
  test("sanitizes rendered HTML and rejects stale asynchronous work", async () => {
    const preview = await Bun.file(
      new URL("../src/preview/markdownPreviewFrame.ts", import.meta.url),
    ).text();

    expect(preview).toContain("DOMPurify.sanitize");
    expect(preview).toContain('FORBID_TAGS: ["embed", "form", "iframe", "object", "script", "style"]');
    expect(preview).toContain('FORBID_ATTR: ["style"]');
    expect(preview).toContain("generation !== this.renderGeneration");
    expect(preview).toContain("markdown-preview-blocked-resource");
  });

  test("uses a debounced in-memory renderer with per-document scroll state", async () => {
    const preview = await Bun.file(
      new URL("../src/preview/markdownPreviewFrame.ts", import.meta.url),
    ).text();

    expect(preview).toContain("const MARKDOWN_RENDER_DELAY_MS = 140");
    expect(preview).toContain("private readonly scrollPositions = new Map<string, number>()");
    expect(preview).toContain("marked.parse(source, { gfm: true, breaks: false })");
    expect(preview).toContain("this.host.scrollTop = Math.min(previousScroll");
  });

  test("keeps Markdown resources workspace-bound and Typst completion isolated", async () => {
    const controller = await Bun.file(
      new URL("../src/appController.ts", import.meta.url),
    ).text();

    expect(controller).toContain("relativeFilePath(this.workspaceRootPath, absolute) === null");
    expect(controller).toContain("if (!isTypstDocumentPath(path)) return []");
    expect(controller).toContain("this.markdownPreviewFrame.schedule(this.activeFilePath, rawText)");
    expect(controller).toContain("this.activateSpellcheckDocument(isMarkdownDocument ? null : path)");
    expect(controller).toContain("Leave the persistent PDF");
  });
});
