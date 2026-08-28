import { invoke } from "@tauri-apps/api/core";
import type { TinymistLspClient, LspStatus } from "../compiler/lsp";
import type { DocumentLanguageController } from "../editor/documentLanguageController";
import type { EditorTab } from "../editor/editorTab";
import type { EditorTabPresentationController } from "../editor/editorTabPresentationController";
import type { LspDocumentController } from "../session/lspDocumentController";
import { fileExtension, isBinaryImagePath, isTypstDocumentPath } from "../platform/fileTypes";
import { fileNameFromPath, filePathKey } from "../platform/paths";
import { participatesInPreviewCompilation } from "../preview/previewPolicy";
import type { PreviewRenderMode } from "../settings";
import { LatestRequestGuard } from "./latestRequestGuard";

export interface ExternalFileReloadDependencies {
  presentation: EditorTabPresentationController;
  documentLanguage: DocumentLanguageController;
  lspDocuments: LspDocumentController;
  openTabs(): EditorTab[];
  activeFilePath(): string | null;
  isInternallySupportedPath(path: string): boolean;
  closeTab(path: string): Promise<void>;
  loadPdfPath(path: string): void;
  renderTabs(): void;
  activeMode(): "CODE" | "WYSIWYM";
  mapMarkupToWysiwym(contents: string): void;
  lspClient(): TinymistLspClient | undefined;
  lspReady(): boolean;
  resolveLspDocument(path: string, contents: string): Promise<{ uri: string; content: string } | null>;
  pinnedMainFilePath(): string | null;
  previewRenderMode(): PreviewRenderMode;
  renderPdfPreview(contents: string): void;
  schedulePdfPreview(contents: string): void;
  setLspStatus(status: LspStatus): void;
  appendWorkspaceWarning(message: string): void;
  invalidateLazyLoad(path: string): void;
}

/** Owns reconciliation of already-open files after accepted external filesystem changes. */
export class ExternalFileReloadController {
  readonly conflictPaths = new Set<string>();
  private readonly reloadRequests = new LatestRequestGuard<string>();

  constructor(private readonly deps: ExternalFileReloadDependencies) {}

  async reloadOpenFiles(refreshPreview = true): Promise<boolean> {
    let changed = false;
    for (const tab of [...this.deps.openTabs()]) {
      const path = tab.path;
      const pathKey = filePathKey(path);
      const request = this.reloadRequests.begin(pathKey);
      const isCurrent = () => (
        this.reloadRequests.isCurrent(request)
        && this.deps.openTabs().includes(tab)
        && filePathKey(tab.path) === pathKey
      );
      const exists = await invoke<boolean>("workspace_path_exists", { path });
      if (!isCurrent()) continue;
      if (!exists) {
        if (tab.isDirty) {
          this.reportConflict(tab.path, "was removed outside Typsastra");
        } else {
          this.conflictPaths.delete(pathKey);
          await this.deps.closeTab(path);
        }
        changed = true;
        continue;
      }

      if (!this.deps.isInternallySupportedPath(tab.path)) continue;
      if (!tab.contentLoaded) {
        this.deps.invalidateLazyLoad(path);
        tab.sizeBytes = undefined;
        tab.lineCount = undefined;
        continue;
      }
      if (fileExtension(tab.path) === "pdf") {
        const activeFilePath = this.deps.activeFilePath();
        if (activeFilePath && filePathKey(tab.path) === filePathKey(activeFilePath)) {
          this.deps.loadPdfPath(tab.path);
        }
        continue;
      }

      let contents: string;
      try {
        contents = isBinaryImagePath(tab.path)
          ? await invoke<string>("read_workspace_file_as_base64", { path })
          : normalizeEditorText(await invoke<string>("read_workspace_file", { path }));
      } catch (error) {
        console.warn(`Unable to reload ${tab.path}:`, error);
        continue;
      }

      if (!isCurrent()) continue;
      if (contents === tab.savedContent) {
        this.conflictPaths.delete(pathKey);
        continue;
      }
      if (contents === tab.content) {
        tab.savedContent = contents;
        tab.isDirty = false;
        this.conflictPaths.delete(pathKey);
        this.deps.renderTabs();
        changed = true;
        continue;
      }
      if (tab.isDirty) {
        this.reportConflict(tab.path, "changed outside Typsastra");
        changed = true;
        continue;
      }

      this.conflictPaths.delete(pathKey);
      await this.applyExternalFileContent(tab, contents, refreshPreview, isCurrent);
      if (isCurrent()) changed = true;
    }
    return changed;
  }

  clearConflict(path: string): void {
    this.conflictPaths.delete(filePathKey(path));
  }

  reportConflict(path: string, reason: string): void {
    const pathKey = filePathKey(path);
    if (this.conflictPaths.has(pathKey)) return;
    this.conflictPaths.add(pathKey);
    this.deps.appendWorkspaceWarning(
      `${fileNameFromPath(path)} ${reason}; unsaved editor content was preserved.`,
    );
    this.deps.setLspStatus({ kind: "error", message: "External change conflicts with unsaved edits" });
  }

  private async applyExternalFileContent(
    tab: EditorTab,
    contents: string,
    refreshPreview: boolean,
    isCurrent: () => boolean,
  ): Promise<void> {
    if (!isCurrent()) return;
    const activeFilePath = this.deps.activeFilePath();
    const isActive = activeFilePath !== null && filePathKey(tab.path) === filePathKey(activeFilePath);
    tab.content = contents;
    tab.savedContent = contents;
    tab.contentLoaded = true;
    tab.isDirty = false;
    tab.undoHistory = undefined;

    if (!isActive) {
      this.deps.renderTabs();
      return;
    }
    if (isBinaryImagePath(tab.path)) {
      const img = document.getElementById("image-viewer-img") as HTMLImageElement | null;
      if (img) img.src = contents;
      this.deps.renderTabs();
      return;
    }
    if (fileExtension(tab.path) === "pdf") {
      if (refreshPreview) this.deps.loadPdfPath(tab.path);
      this.deps.renderTabs();
      return;
    }

    this.deps.presentation.replaceActiveTextContents(tab, contents);
    this.deps.renderTabs();
    if (tab.path.toLowerCase().endsWith(".typ")) {
      this.deps.documentLanguage.updateOutlineNow(tab.path, contents);
    } else {
      this.deps.documentLanguage.clearOutline();
    }
    if (this.deps.activeMode() === "WYSIWYM") this.deps.mapMarkupToWysiwym(contents);

    const version = this.deps.lspDocuments.nextVersion();
    this.deps.lspDocuments.latestVersion = version;
    tab.version = version;
    tab.latestVersion = version;
    let lspUpdated = false;
    const client = this.deps.lspClient();
    if (this.deps.lspReady() && client) {
      const lspRes = await this.deps.resolveLspDocument(tab.path, contents);
      if (lspRes && isCurrent()) {
        await this.deps.lspDocuments.openIfNeeded(lspRes.uri, lspRes.content, version);
        if (!isCurrent()) return;
        await client.notifyTextChange(lspRes.uri, lspRes.content, version);
        if (!isCurrent()) return;
        await client.notifyTextSave(lspRes.uri, lspRes.content);
        if (!isCurrent()) return;
        lspUpdated = true;
      }
    }
    if (!isCurrent()) return;
    if (
      refreshPreview
      && participatesInPreviewCompilation(tab.path, this.deps.pinnedMainFilePath(), tab.previewImported)
      && tab.path.toLowerCase().endsWith(".typ")
      && !tab.previewDisabled
    ) {
      if (this.deps.previewRenderMode() === "on-save") {
        this.deps.renderPdfPreview(contents);
      } else {
        this.deps.schedulePdfPreview(contents);
      }
    }
    this.deps.setLspStatus({
      kind: lspUpdated || !isTypstDocumentPath(tab.path) ? "preview-ready" : "sync-pending",
      message: lspUpdated
        ? "Reloaded external file change"
        : isTypstDocumentPath(tab.path)
          ? "Reloaded external file; preview update queued"
          : "Reloaded external file",
    });
  }
}

function normalizeEditorText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
