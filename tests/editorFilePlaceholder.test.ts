import { describe, expect, test } from "bun:test";

const source = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("non-text editor file information", () => {
  test("shows useful image and PDF metadata beside the live preview", async () => {
    const guard = await source("../src/editor/editorFileGuardController.ts");
    const presentation = await source("../src/editor/editorTabPresentationController.ts");
    const app = await source("../src/appController.ts");
    const styles = await source("../src/style.css");

    expect(guard).toContain('metadata.className = "editor-file-metadata"');
    expect(guard).toContain('addMetadata("Type"');
    expect(guard).toContain('addMetadata("Size", "Loading…", "size")');
    expect(guard).toContain('addMetadata("Pages", "Loading…", "pages")');
    expect(guard).toContain('addMetadata("Dimensions", "Loading…", "dimensions")');
    expect(guard).toContain('addMetadata("Location", path, "location")');
    expect(guard).toContain('invoke<number>("workspace_file_size", { path })');
    expect(guard).toContain("image.naturalWidth.toLocaleString()");
    expect(guard).toContain("updatePdfPageCount(path: string, pageCount: number)");
    expect(presentation).toContain("renderNonTextPlaceholder(path, unsupportedFile, tab.content)");
    expect(app).toContain("updatePdfPageCount(this.activeFilePath, status.pageCount)");
    expect(styles).toContain(".editor-file-metadata");
  });
});
