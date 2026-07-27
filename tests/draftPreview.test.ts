import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const controller = readFileSync(join(root, "src", "appController.ts"), "utf8");
const previewFrame = readFileSync(join(root, "src", "preview", "previewFrame.ts"), "utf8");
const styles = readFileSync(join(root, "src", "style.css"), "utf8");
const html = readFileSync(join(root, "index.html"), "utf8");
const plan = readFileSync(join(root, "docs", "V0_6_0_DRAFT_PREVIEW_IMPLEMENTATION_PLAN.md"), "utf8");

describe("Draft Preview", () => {
  test("exposes an explicit workspace-persisted Normal/Draft control", () => {
    expect(html).toContain('id="preview-content-normal-btn"');
    expect(html).toContain('id="preview-content-draft-btn"');
    expect(controller).toContain("previewContentMode: this.previewContentMode");
    expect(controller).toContain('previewContentMode: "normal"');
    expect(styles).toMatch(/\.preview-content-mode-control\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*max-content\);/s);
    expect(styles).toMatch(/\.preview-content-mode-button\s*\{[^}]*min-width:\s*76px;/s);
    expect(styles).toMatch(/data-compiling="true"[^}]*::after\s*\{[^}]*position:\s*absolute;/s);
  });

  test("commits the requested mode and image manifest only after PDF presentation", () => {
    const modeCommit = controller.indexOf("this.presentedPreviewContentMode = generationContentMode");
    const presentation = controller.lastIndexOf("await this.loadPdfPath(", modeCommit);
    const manifestCommit = controller.indexOf("this.draftImageAssets = generationContentMode", presentation);
    expect(presentation).toBeGreaterThan(-1);
    expect(modeCommit).toBeGreaterThan(presentation);
    expect(manifestCommit).toBeGreaterThan(presentation);
  });

  test("uses draft annotations for safe hover inspection and ordinary inverse sync", () => {
    expect(previewFrame).toContain('target.kind === "draft-image"');
    expect(previewFrame).toContain("this.hideDraftImagePopover()");
    expect(previewFrame).toContain("URL.revokeObjectURL");
    expect(previewFrame).toContain('name: "preview.draft-hover"');
    expect(previewFrame).toContain("this.onPreviewClick({ draftImageId: annotationTarget.id })");
    expect(controller).toContain("await this.navigateToDraftPreviewImage(point.draftImageId)");
    expect(previewFrame).not.toContain('if (this.annotationTargets.get(annotationLink)?.kind === "draft-image")');
    expect(plan).toContain("including its raw path label");
  });

  test("documents exact intrinsic ratio and original-image export guarantees", () => {
    expect(plan).toMatch(/exact\s+intrinsic aspect ratio/);
    expect(plan).toContain("PDF export always uses Normal Preview");
    expect(plan).toContain("original images");
  });
});
