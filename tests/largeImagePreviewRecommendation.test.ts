import { describe, expect, test } from "bun:test";

describe("large-image preview recommendation", () => {
  test("uses aggregate image pressure to recommend render on save", async () => {
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const start = controller.indexOf("private async recommendOnSaveForImageHeavyPreview");
    const end = controller.indexOf("private async showReleaseSummaryIfNeeded", start);
    const method = controller.slice(start, end);

    expect(method).toContain('renderMode !== "on-type"');
    expect(method).toContain("estimatedTotalDecodedBytes > MAX_RECOMMENDED_TOTAL_DECODED_PREVIEW_IMAGE_BYTES");
    expect(method).toContain("totalSourceBytes > MAX_RECOMMENDED_PREVIEW_IMAGE_SOURCE_BYTES");
    expect(method).toContain("uniqueImageCount >= MAX_RECOMMENDED_UNIQUE_PREVIEW_IMAGES");
    expect(method).toContain('title: "Image-heavy Live Preview"');
    expect(method).toContain('{ id: "keep-on-type", label: "Keep On Type" }');
    expect(method).toContain('{ id: "switch-on-save", label: "Switch to On Save", primary: true }');
    expect(method).toContain('settings.preview.renderMode = "on-save"');
    expect(method).toContain("Your images and source files will not be changed.");
    expect(controller).toContain("activeSourceContents: activeSourcePath ? this.editorInstance.state.doc.toString() : null");
    expect(method).not.toContain("Render Anyway");
    expect(method).not.toContain("save_workspace_file");
  });

  test("registers the read-only raster metadata command", async () => {
    const backend = await Bun.file(new URL("../src-tauri/src/lib.rs", import.meta.url)).text();
    expect(backend).toContain("#[tauri::command]\nfn typst_preview_image_profile(");
    expect(backend).toMatch(/\.invoke_handler\(tauri::generate_handler!\[[\s\S]*typst_preview_image_profile,/);
    expect(backend).toContain("estimated_total_decoded_bytes");
    expect(backend).toContain("reference_count");
  });

  test("publishes oversized image references in the line-number gutter", async () => {
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const warnings = await Bun.file(new URL("../src/editor/imageWarnings.ts", import.meta.url)).text();
    const consoleController = await Bun.file(new URL("../src/diagnostics/logConsoleController.ts", import.meta.url)).text();
    const markup = await Bun.file(new URL("../index.html", import.meta.url)).text();
    expect(controller).toContain("setImageOptimizationWarningsEffect.of(warnings)");
    expect(controller).toContain("setImageOptimizationIssues(oversizedImages.map");
    expect(controller).toContain('channel: "images"');
    expect(controller).toContain("Downscale its pixel dimensions");
    expect(controller).toContain("may reduce the exported PDF size");
    expect(warnings).toContain("lineNumberMarkers.from(field)");
    expect(warnings).toContain('marker.className = "cm-image-optimization-marker"');
    expect(consoleController).toContain('LogEntryChannel = "lsp" | "spellcheck" | "images" | "dev"');
    expect(consoleController).toContain('this.setTabCount("images", imageWarnings)');
    expect(consoleController).toContain('entry.channel === "images" && entry.locations?.[0]');
    expect(consoleController).toContain("void this.onNavigate({ ...entry, ...first, locations: undefined })");
    expect(markup).toContain('data-log-console-tab="images"');
  });

  test("plans a source-preserving draft preview for v0.6.0", async () => {
    const roadmap = await Bun.file(new URL("../docs/ROADMAP.md", import.meta.url)).text();
    const versionStart = roadmap.indexOf("## v0.6.0");
    const versionEnd = roadmap.indexOf("## v0.9.0", versionStart);
    const milestone = roadmap.slice(versionStart, versionEnd);
    expect(milestone).toContain("**Draft Preview**");
    expect(milestone).toContain("layout-preserving placeholders");
    expect(milestone).toContain("temporary UI overlay on demand");
    expect(milestone).toMatch(/never used for final PDF export/);
  });
});
