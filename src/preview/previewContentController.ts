import { invoke } from "@tauri-apps/api/core";
import type { EditorTab } from "../editor/editorTab";
import { fileExtension, isBinaryImagePath, isTypstDocumentPath } from "../platform/fileTypes";
import type { PreviewRenderMode } from "../settings";
import type { ImagePreviewController } from "./imagePreviewController";
import type { PreviewFrame } from "./previewFrame";
import {
  previewLspMainPath,
  previewRefreshStyle,
  previewSessionIdentity,
  researchDocumentIdentity,
  type PreviewTarget,
} from "./previewPolicy";

function normalizeEditorText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export interface PreviewContentDependencies {
  previewFrame: PreviewFrame;
  imagePreview: ImagePreviewController;
  isImageToolActive(): boolean;
  getActiveFilePath(): string | null;
  getPinnedMainFilePath(): string | null;
  getWorkspaceRootPath(): string | null;
  getPreviewSessionKey(): string | null;
  getPreviewRenderMode(): PreviewRenderMode;
  getActiveTab(): EditorTab | null;
  getEditorText(): string;
  isInternallySupportedPath(path: string): boolean;
  updateActionsToolbar(path: string): void;
  prepareTemplateAwarePreview(
    target: PreviewTarget,
    activePath: string,
    contents: string,
  ): Promise<PreviewTarget>;
  ensureLargePreviewApproved(rootPath: string | null): Promise<boolean>;
  updatePinnedMain(path: string | null): Promise<boolean>;
  applyPreviewTargetToTab(tab: EditorTab, target: PreviewTarget): void;
  configureDocumentLanguageTools(contents: string): void;
  invalidatePreviewWork(reason: string): void;
  renderPdfPreview(contents: string): Promise<void>;
  loadPdfPath(path: string, identity: string): Promise<number>;
  setPreviewPaneHtml(html: string): void;
}

/** Owns selection of the active preview surface and restoration of document preview content. */
export class PreviewContentController {
  public constructor(private readonly deps: PreviewContentDependencies) {}

  public noMainFileMessage(): string {
    return (
      `<div class="preview-disabled-placeholder">` +
      `<div class="preview-disabled-title preview-accent-title" style="font-size:18px;margin-bottom:12px;">No Main File Selected</div>` +
      `<div class="preview-disabled-msg">Right-click any <code style="background:var(--ui-hover);padding:1px 5px;border-radius:3px;">.typ</code> file in the Explorer and choose <strong>Set as Main File</strong> to enable live preview and export.</div>` +
      `</div>`
    );
  }

  public disabledPreviewMessage(): string {
    return (
      `<div class="preview-disabled-placeholder">` +
      `<div class="preview-disabled-icon">🚫</div>` +
      `<div class="preview-disabled-title">Preview Unavailable</div>` +
      `<div class="preview-disabled-msg">This file is not imported or included by the main document. Only the main file and its dependencies are previewed.</div>` +
      `<div class="preview-disabled-msg" style="margin-top: 8px; font-size: 12px; opacity: 0.75;">Include this file from the configured main document to preview it.</div>` +
      `</div>`
    );
  }

  public renderImageToolPreview(source: string | null, imagePath?: string): void {
    if (!this.deps.isImageToolActive()) return;
    if (!source) {
      this.deps.imagePreview.clear();
      this.deps.updateActionsToolbar(imagePath ?? "image-tools.png");
      if (imagePath) {
        this.deps.previewFrame.setLoading("Preparing image preview…", false);
        return;
      }
      this.deps.previewFrame.setMessage(
        `<div class="preview-disabled-placeholder">` +
        `<div class="guardrail-placeholder-content">` +
        `<div class="preview-disabled-title preview-accent-title">Image Preview</div>` +
        `<div class="preview-disabled-msg">Select an image in the sidebar to preview it.</div>` +
        `</div></div>`,
      );
      return;
    }
    this.renderInteractiveImageViewer(source, imagePath);
  }

  public renderInteractiveImageViewer(
    src: string,
    previewPath = this.deps.getActiveFilePath() ?? "preview.png",
  ): void {
    this.deps.imagePreview.render(src, previewPath);
  }

  public async refreshActivePreviewRoot(forceRender = false): Promise<void> {
    if (this.deps.isImageToolActive()) return;
    const activeFilePath = this.deps.getActiveFilePath();
    if (!activeFilePath) return;
    const path = activeFilePath;
    const ext = fileExtension(path);
    const unsupportedFile = !this.deps.isInternallySupportedPath(path);
    const isPdf = ext === "pdf";

    this.deps.imagePreview.clear();
    this.deps.updateActionsToolbar(path);

    if (unsupportedFile || isBinaryImagePath(path) || isPdf) {
      const tab = this.deps.getActiveTab();
      if (!tab) return;
      if (isBinaryImagePath(path)) {
        this.renderInteractiveImageViewer(tab.content);
      } else if (isPdf) {
        void this.deps.loadPdfPath(path, path);
      } else {
        this.deps.previewFrame.setMessage(
          `<div class="preview-disabled-placeholder">` +
          `<div class="preview-disabled-title">Preview Unavailable</div>` +
          `<div class="preview-disabled-msg">Open this file with its system application to view it.</div>` +
          `</div>`,
        );
      }
      return;
    }

    if (ext === "svg") {
      this.deps.previewFrame.setMessageOverlay(
        `<div style="display:flex;align-items:center;justify-content:center;height:100%;width:100%;background:var(--ui-bg);box-sizing:border-box;padding:20px;overflow:auto;">` +
        this.deps.getEditorText() +
        `</div>`,
      );
      return;
    }
    if (!isTypstDocumentPath(path)) {
      this.deps.previewFrame.setMessageOverlay(
        `<div class="preview-disabled-placeholder">` +
        `<div class="preview-disabled-title">Preview Unavailable</div>` +
        `<div class="preview-disabled-msg">Live preview is not supported for ${ext.toUpperCase() || "this"} files.</div>` +
        `</div>`,
      );
      return;
    }
    if (!this.deps.getPinnedMainFilePath()) {
      this.deps.previewFrame.setMessage(this.noMainFileMessage());
      return;
    }
    const activeTab = this.deps.getActiveTab();
    const contents = activeTab?.contentLoaded
      ? this.deps.getEditorText()
      : normalizeEditorText(await invoke<string>("read_workspace_file", { path }));
    let target = await invoke<PreviewTarget>("resolve_preview_main", {
      filePath: this.deps.getActiveFilePath(),
      workspaceRootPath: this.deps.getWorkspaceRootPath(),
      fileContents: contents,
      pinnedMainPath: this.deps.getPinnedMainFilePath(),
    });
    if (target.disabled) {
      if (activeTab) {
        this.deps.applyPreviewTargetToTab(activeTab, target);
        this.deps.configureDocumentLanguageTools(contents);
      }
      this.deps.invalidatePreviewWork(`${this.deps.getActiveFilePath()} does not participate in the configured main preview`);
      this.deps.previewFrame.setMessage(this.disabledPreviewMessage());
      return;
    }
    target = await this.deps.prepareTemplateAwarePreview(target, this.deps.getActiveFilePath()!, contents);
    if (!await this.deps.ensureLargePreviewApproved(target.rootPath)) {
      const tab = this.deps.getActiveTab();
      if (tab) {
        this.deps.applyPreviewTargetToTab(tab, target);
        this.deps.configureDocumentLanguageTools(contents);
      }
      return;
    }
    await this.deps.updatePinnedMain(previewLspMainPath(target));
    const docIdentity = target.rootPath
      ? researchDocumentIdentity(
          this.deps.getWorkspaceRootPath() ?? target.rootPath,
          target.mainPath,
          this.deps.getActiveFilePath()!,
        )
      : null;
    const identity = target.rootPath
      ? previewSessionIdentity(
          target.rootPath,
          previewRefreshStyle(this.deps.getPreviewRenderMode()),
          docIdentity ?? undefined,
        )
      : null;
    const unchanged = identity?.key === this.deps.getPreviewSessionKey();
    if (!activeTab) return;
    this.deps.applyPreviewTargetToTab(activeTab, target);
    this.deps.configureDocumentLanguageTools(contents);
    // A tool surface can temporarily replace and unmount the preview without
    // changing the underlying document session. Only reuse an unchanged
    // session while its preview is still mounted; otherwise restore it.
    if (unchanged && !forceRender && this.deps.previewFrame.currentUrl) return;

    if (!target.rootPath) {
      this.deps.setPreviewPaneHtml(`<div style="padding: 20px; color: var(--ui-header-text); font-family: var(--font-family-sans);">No preview root found for this library/template file. Diagnostics are still active.</div>`);
      return;
    }

    await this.deps.renderPdfPreview(contents);
  }
}
