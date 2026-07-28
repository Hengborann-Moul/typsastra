import { describe, expect, test } from "bun:test";

describe("large-image preview recommendation", () => {
  test("uses aggregate image pressure without blocking preview compilation", async () => {
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const start = controller.indexOf("private updateImageHeavyPreviewWarning");
    const end = controller.indexOf("private async showImageHeavyPreviewDetails", start);
    const method = controller.slice(start, end);

    expect(method).toContain("estimatedTotalDecodedBytes > MAX_RECOMMENDED_TOTAL_DECODED_PREVIEW_IMAGE_BYTES");
    expect(method).toContain("totalSourceBytes > MAX_RECOMMENDED_PREVIEW_IMAGE_SOURCE_BYTES");
    expect(method).toContain("uniqueImageCount >= MAX_RECOMMENDED_UNIQUE_PREVIEW_IMAGES");
    expect(method).toContain('getElementById("preview-image-warning-btn")');
    expect(method).toContain('button.dataset.active = "true"');
    expect(method).toContain("Click for details.");
    expect(method).toContain("Preview may take longer to update after each save.");
    expect(controller).toContain("activeSourceContents: activeSourcePath ? this.editorInstance.state.doc.toString() : null");
    expect(controller).toContain('title: "Image-heavy Document"');
    expect(controller).toContain('{ id: "view-images", label: "View Images", primary: false }');
    expect(controller).toContain('{ id: "switch-on-save", label: "Use On Save", primary: true }');
    expect(controller).toContain('await this.setPreviewRenderMode("on-save")');
    expect(controller).toContain("Compilation will continue normally");
    const renderStart = controller.indexOf("private async renderPdfPreview");
    const renderEnd = controller.indexOf("private schedulePdfPreview", renderStart);
    const renderMethod = controller.slice(renderStart, renderEnd);
    expect(renderMethod).toContain("this.updateImageHeavyPreviewWarning(imageProfile);");
    expect(renderMethod).not.toContain("recommendOnSaveForImageHeavyPreview");
    expect(renderMethod).not.toMatch(/updateImageHeavyPreviewWarning\(imageProfile\)[\s\S]{0,80}return;/);
  });

  test("recommends hard offenders and a bounded set of aggregate contributors", async () => {
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const start = controller.indexOf("private recommendedImageOptimizationAssets");
    const end = controller.indexOf("private imageOptimizationMessage", start);
    const method = controller.slice(start, end);

    expect(controller).toContain("const MAX_RECOMMENDED_DECODED_PREVIEW_IMAGE_BYTES = 64 * 1024 * 1024");
    expect(controller).toContain("const AGGREGATE_IMAGE_CONTRIBUTOR_BYTES = 32 * 1024 * 1024");
    expect(controller).toContain("const MAX_RECOMMENDED_SINGLE_IMAGE_SOURCE_BYTES = 8 * 1024 * 1024");
    expect(controller).toContain("const MAX_AGGREGATE_IMAGE_OPTIMIZATION_SUGGESTIONS = 5");
    expect(method).toContain("image.estimatedDecodedBytes > MAX_RECOMMENDED_DECODED_PREVIEW_IMAGE_BYTES");
    expect(method).toContain("image.sourceBytes > MAX_RECOMMENDED_SINGLE_IMAGE_SOURCE_BYTES");
    expect(method).toContain("profile.estimatedTotalDecodedBytes > MAX_RECOMMENDED_TOTAL_DECODED_PREVIEW_IMAGE_BYTES");
    expect(method).toContain("image.estimatedDecodedBytes > AGGREGATE_IMAGE_CONTRIBUTOR_BYTES");
    expect(method).toContain("MAX_AGGREGATE_IMAGE_OPTIMIZATION_SUGGESTIONS - selected.size");
    expect(controller).toContain("this.recommendedImageOptimizationAssets(profile)");
  });

  test("registers the read-only raster metadata command", async () => {
    const backend = await Bun.file(new URL("../src-tauri/src/lib.rs", import.meta.url)).text();
    expect(backend).toContain("#[tauri::command]\nfn typst_preview_image_profile(");
    expect(backend).toMatch(/\.invoke_handler\(tauri::generate_handler!\[[\s\S]*typst_preview_image_profile,/);
    expect(backend).toContain("estimated_total_decoded_bytes");
    expect(backend).toContain("reference_count");
  });

  test("publishes oversized image references in a dedicated warning gutter", async () => {
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const warnings = await Bun.file(new URL("../src/editor/imageWarnings.ts", import.meta.url)).text();
    const consoleController = await Bun.file(new URL("../src/diagnostics/logConsoleController.ts", import.meta.url)).text();
    const markup = await Bun.file(new URL("../index.html", import.meta.url)).text();
    expect(controller).toContain("setImageOptimizationWarningsEffect.of(warnings)");
    expect(controller).toContain("setImageOptimizationIssues(optimizationCandidates.map");
    expect(controller).toContain('channel: "images"');
    expect(controller).toContain("Downscale its pixel dimensions");
    expect(controller).toContain("may reduce the exported PDF size");
    expect(warnings).toContain('class: "cm-warningGutter"');
    expect(warnings).toContain("initialSpacer:");
    expect(warnings).toContain('marker.className = "cm-image-optimization-marker"');
    expect(consoleController).toContain('LogEntryChannel = "lsp" | "spellcheck" | "images" | "dev"');
    expect(consoleController).toContain('this.setTabCount("images", imageWarnings)');
    expect(consoleController).toContain('entry.channel === "images" && entry.locations?.[0]');
    expect(consoleController).toContain("void this.onNavigate({ ...entry, ...first, locations: undefined })");
    expect(markup).toContain('data-log-console-tab="images"');
    expect(markup).toContain('id="preview-image-warning-btn"');
    expect(warnings).toContain('createAppIcon("triangleAlert", { size: 17 })');
    expect(controller).toContain('getElementById("preview-image-warning-btn")');
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
