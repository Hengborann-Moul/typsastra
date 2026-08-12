import { invoke } from "@tauri-apps/api/core";
import type { EditorTab } from "../editor/editorTab";
import { fileExtension, isBinaryImagePath, isTypstDocumentPath } from "../platform/fileTypes";
import { filePathKey } from "../platform/paths";
import type { PreviewFrame } from "../preview/previewFrame";
import type { PreviewSessionController } from "../preview/previewSessionController";
import type { PreviewTarget } from "../preview/previewPolicy";
import {
  largeFileOpeningNotice,
  largeMainPreviewOpeningNotice,
  type LargeFileOpeningNotice,
} from "./largeFileOpening";

export interface LargePreviewGuardDependencies {
  previewSession: PreviewSessionController;
  previewFrame(): PreviewFrame;
  workspaceRootPath(): string | null;
  pinnedMainFilePath(): string | null;
  pinnedLspMainPath(): string | null;
  lspReady(): boolean;
  activeTab(): EditorTab | null;
  isInternallySupportedPath(path: string): boolean;
  showLargeFileConfirmation(tab: EditorTab, notice: LargeFileOpeningNotice): void;
  setWorkspaceServicesDeferred(deferred: boolean): void;
}

/** Owns large-file and aggregate preview approval policy/state. */
export class LargePreviewGuardController {
  readonly approvedRoots = new Set<string>();
  readonly inspectedRoots = new Set<string>();
  private blockedRootValue: string | null = null;

  constructor(private readonly deps: LargePreviewGuardDependencies) {}

  get blockedRoot(): string | null { return this.blockedRootValue; }
  set blockedRoot(value: string | null) { this.blockedRootValue = value; }

  async noticeForTab(tab: EditorTab): Promise<LargeFileOpeningNotice | null> {
    if (tab.sizeBytes === undefined) {
      try {
        tab.sizeBytes = await invoke<number>("workspace_file_size", { path: tab.path });
      } catch {
        return null;
      }
    }
    const sizeBytes = tab.sizeBytes;
    if (sizeBytes === undefined) return null;
    const sizeNotice = largeFileOpeningNotice(tab.path, sizeBytes);
    if (
      sizeNotice?.kind === "pdf"
      || fileExtension(tab.path) === "pdf"
      || isBinaryImagePath(tab.path)
      || !this.deps.isInternallySupportedPath(tab.path)
    ) return sizeNotice;

    if (!sizeNotice && tab.lineCount === undefined) {
      try {
        tab.lineCount = await invoke<number>("workspace_text_line_count", { path: tab.path });
      } catch {
        return null;
      }
    }
    const textNotice = sizeNotice ?? largeFileOpeningNotice(tab.path, sizeBytes, tab.lineCount);
    if (textNotice || !isTypstDocumentPath(tab.path)) return textNotice;

    const target = await this.previewTargetForUnloadedTab(tab);
    if (!target?.rootPath || target.disabled) return null;
    return this.noticeForRoot(target.rootPath);
  }

  async previewTargetForUnloadedTab(tab: EditorTab): Promise<PreviewTarget | null> {
    if (!isTypstDocumentPath(tab.path)) return null;
    try {
      return await invoke<PreviewTarget>("resolve_preview_main", {
        filePath: tab.path,
        workspaceRootPath: this.deps.workspaceRootPath(),
        fileContents: tab.contentLoaded ? tab.content : null,
        pinnedMainPath: this.deps.pinnedMainFilePath(),
      });
    } catch {
      return null;
    }
  }

  async approveForTab(tab: EditorTab, notice: LargeFileOpeningNotice): Promise<void> {
    const target = notice.previewRootPath
      ? { rootPath: notice.previewRootPath }
      : await this.previewTargetForUnloadedTab(tab);
    const rootPath = target?.rootPath;
    if (!rootPath) return;
    const rootKey = filePathKey(rootPath);
    this.approvedRoots.add(rootKey);
    this.inspectedRoots.add(rootKey);
    if (!this.blockedRootValue) return;
    const blockedKey = filePathKey(this.blockedRootValue);
    if (blockedKey === rootKey || blockedKey === filePathKey(tab.path)) {
      this.blockedRootValue = null;
    }
  }

  activeCompilerPreviewMatchesRoot(rootPath: string): boolean {
    const session = this.deps.previewSession;
    const activeRootMatches = [session.rootPath, session.mainPath]
      .some(path => path !== null && filePathKey(path) === filePathKey(rootPath));
    const previewFrame = this.deps.previewFrame();
    const mountedSessionMatches = Boolean(
      session.sessionKey
      && previewFrame.currentSessionKey === session.sessionKey
      && previewFrame.currentUrl
    );
    const pinnedLspMainPath = this.deps.pinnedLspMainPath();
    const lspAlreadyOwnsRoot = Boolean(
      this.deps.lspReady()
      && pinnedLspMainPath
      && filePathKey(pinnedLspMainPath) === filePathKey(rootPath)
    );
    return lspAlreadyOwnsRoot || (activeRootMatches && mountedSessionMatches);
  }

  async noticeForRoot(rootPath: string): Promise<LargeFileOpeningNotice | null> {
    try {
      const stats = await invoke<{ sizeBytes: number; lineCount: number; fileCount: number }>(
        "typst_preview_source_stats",
        { rootPath },
      );
      return largeMainPreviewOpeningNotice(
        rootPath,
        stats.sizeBytes,
        stats.lineCount,
        stats.fileCount,
      );
    } catch {
      return null;
    }
  }

  async ensureApproved(rootPath: string | null): Promise<boolean> {
    if (!rootPath || this.activeCompilerPreviewMatchesRoot(rootPath)) return true;
    const rootKey = filePathKey(rootPath);
    if (this.approvedRoots.has(rootKey) || this.inspectedRoots.has(rootKey)) return true;
    if (this.blockedRootValue && filePathKey(this.blockedRootValue) === rootKey) return false;
    const notice = await this.noticeForRoot(rootPath);
    if (!notice) {
      this.inspectedRoots.add(rootKey);
      return true;
    }

    this.blockedRootValue = rootPath;
    this.deps.setWorkspaceServicesDeferred(true);
    const activeTab = this.deps.activeTab();
    if (activeTab) {
      this.deps.showLargeFileConfirmation(activeTab, notice);
    } else {
      this.deps.previewFrame().setMessage(
        `<div class="preview-disabled-placeholder guardrail-paired-placeholder">` +
        `<div class="guardrail-placeholder-content">` +
        `<div class="preview-disabled-title">Preview Waiting for File Approval</div>` +
        `<div class="preview-disabled-msg">Open the large Typst file in the editor to start its compiler preview.</div>` +
        `</div></div>`,
      );
    }
    return false;
  }
}
