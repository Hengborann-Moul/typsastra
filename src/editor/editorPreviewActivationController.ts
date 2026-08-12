import { invoke } from "@tauri-apps/api/core";
import type { EditorTab, PreviewSessionState } from "./editorTab";
import type { LspDocumentController, LspDocumentResolution } from "../session/lspDocumentController";
import type { PreviewFrame } from "../preview/previewFrame";
import type { PreviewSessionController } from "../preview/previewSessionController";
import { previewLspMainPath, type PreviewTarget } from "../preview/previewPolicy";

export interface EditorPreviewActivationOptions {
  skipPreviewActivation?: boolean;
  preservePreviewSession?: PreviewSessionState;
}

export interface EditorPreviewActivationContext {
  target: PreviewTarget | null;
  guarded: boolean;
  presentationReused: boolean;
}

export interface EditorPreviewActivationDependencies {
  previewSession: PreviewSessionController;
  lspDocuments: LspDocumentController;
  previewFrame(): PreviewFrame;
  workspaceRootPath(): string | null;
  pinnedMainFilePath(): string | null;
  lspAvailable(): boolean;
  currentVersion(): number;
  resolveLspDocument(path: string, text: string): Promise<LspDocumentResolution>;
  ensureLargePreviewApproved(rootPath: string | null): Promise<boolean>;
  invalidatePreviewWork(reason: string): void;
  noMainFileMessage(): string;
  disabledPreviewMessage(): string;
  renderPdfPreview(contents: string): void;
}

/** Owns compiler-preview session selection and LSP activation for an editor tab. */
export class EditorPreviewActivationController {
  constructor(private readonly deps: EditorPreviewActivationDependencies) {}

  async prepare(
    tab: EditorTab,
    path: string,
    isTypstDocument: boolean,
    options: EditorPreviewActivationOptions,
  ): Promise<EditorPreviewActivationContext> {
    let presentationReused = false;
    let guarded = false;
    let target: PreviewTarget | null = null;

    if (options.skipPreviewActivation) {
      return { target, guarded, presentationReused };
    }
    if (options.preservePreviewSession) {
      this.deps.previewSession.applySessionToTab(tab, options.preservePreviewSession);
      if (options.preservePreviewSession.previewSessionKey) {
        presentationReused = this.deps.previewFrame().activateSession(
          options.preservePreviewSession.previewSessionKey,
        );
      }
      return { target, guarded, presentationReused };
    }
    if (!isTypstDocument) return { target, guarded, presentationReused };
    if (!this.deps.pinnedMainFilePath()) {
      this.deps.previewFrame().setMessage(this.deps.noMainFileMessage());
      return { target, guarded, presentationReused };
    }

    const resolvedTarget = await invoke<PreviewTarget>("resolve_preview_main", {
      filePath: path,
      workspaceRootPath: this.deps.workspaceRootPath(),
      fileContents: tab.content,
      pinnedMainPath: this.deps.pinnedMainFilePath(),
    });
    target = resolvedTarget;
    if (resolvedTarget.disabled) {
      this.deps.previewSession.applyTargetToTab(tab, resolvedTarget);
      this.deps.invalidatePreviewWork(`${path} does not participate in the configured main preview`);
      return { target, guarded, presentationReused };
    }

    target = await this.deps.previewSession.prepareTemplateAware(resolvedTarget, path, tab.content);
    guarded = !(await this.deps.ensureLargePreviewApproved(target.rootPath));
    if (guarded) {
      this.deps.previewSession.applyTargetToTab(tab, target);
      return { target, guarded, presentationReused };
    }

    const existingMainSession = this.deps.previewSession.captureCurrentMainSessionForImportedTarget(target);
    if (existingMainSession) {
      this.deps.previewSession.applySessionToTab(tab, existingMainSession);
      if (existingMainSession.previewSessionKey) {
        presentationReused = this.deps.previewFrame().activateSession(existingMainSession.previewSessionKey);
      }
    } else {
      this.deps.previewSession.applyTargetToTab(tab, target);
      if (tab.previewSessionKey) {
        presentationReused = this.deps.previewFrame().activateSession(tab.previewSessionKey);
      }
    }
    return { target, guarded, presentationReused };
  }

  async finish(
    tab: EditorTab,
    path: string,
    isTypstDocument: boolean,
    context: EditorPreviewActivationContext,
    options: EditorPreviewActivationOptions,
  ): Promise<void> {
    if (options.skipPreviewActivation || !isTypstDocument) return;

    if (this.deps.lspAvailable()) {
      const lspRes = await this.deps.resolveLspDocument(path, tab.content);
      if (lspRes) {
        await this.deps.lspDocuments.openIfNeeded(
          lspRes.uri,
          lspRes.content,
          this.deps.currentVersion(),
        );
      }
      if (!context.guarded) {
        const lspMainPath = context.target
          ? previewLspMainPath(context.target)
          : (this.deps.previewSession.standalone
              ? this.deps.previewSession.rootPath
              : (this.deps.previewSession.mainPath ?? this.deps.previewSession.rootPath));
        const pinChanged = await this.deps.lspDocuments.updatePinnedMain(lspMainPath);
        if (pinChanged) await this.deps.lspDocuments.recheckActiveAfterPin(tab.content);
      }

      if (context.guarded || options.preservePreviewSession) return;
      if (!this.deps.pinnedMainFilePath()) {
        this.deps.previewFrame().setMessage(this.deps.noMainFileMessage());
      } else if (context.target?.disabled) {
        this.deps.previewFrame().setMessage(this.deps.disabledPreviewMessage());
      } else if (this.deps.previewSession.rootPath) {
        if (!context.presentationReused) this.deps.renderPdfPreview(tab.content);
      } else {
        this.deps.previewFrame().setMessage(
          `<div style="padding: 20px; color: var(--ui-header-text); font-family: var(--font-family-sans);">No preview root found for this library/template file. Diagnostics are still active.</div>`,
        );
      }
      return;
    }

    if (
      !context.guarded
      && !options.preservePreviewSession
      && this.deps.previewSession.rootPath
      && !this.deps.previewSession.disabled
    ) {
      this.deps.renderPdfPreview(tab.content);
    }
  }
}
