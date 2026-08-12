import type { EditorView } from "@codemirror/view";
import { TinymistLspClient, type LspDiagnostic, type LspInverseSyncResult, type LspLogEntry, type LspSourcePosition, type LspStatus } from "../compiler/lsp";
import type { ToolchainStatus } from "../toolchain/toolchainController";
import type { DocumentOutlineController } from "../outline/documentOutline";

export interface PreviewStartupFailureContext {
  path: string;
  taskId: string;
  refreshStyle: "on-type" | "on-save";
  partialRendering: boolean;
  message: string;
}

export interface TinymistIntegrationDependencies {
  workspaceRootPath(): string | null;
  editor(): EditorView;
  setLspStatus(status: LspStatus): void;
  handleInverseSync(uri: string | undefined, position: LspSourcePosition): Promise<LspInverseSyncResult>;
  handleDiagnostics(uri: string, diagnostics: LspDiagnostic[], version?: number): Promise<void>;
  appendLspLog(entry: LspLogEntry): void;
  updateOutlinePreviewPositions(items: Parameters<DocumentOutlineController["updatePreviewPositions"]>[0]): void;
  discoverSurroundWithOptions(): Promise<void>;
  resetSurroundWithDiscovery(): void;
  resetSourceMap(options?: { retry?: boolean }): void;
  resetSourceMapIfTaskFailed(taskId: string): void;
  resetLspDocuments(): void;
  clearPendingLspSync(): void;
  clearForwardSync(): void;
  clearDiagnostics(): void;
  clearSourceMapWarmup(): void;
  resetPdfSourceMapIdentity(): void;
  setLspReady(ready: boolean): void;
  appendDeveloperLog(entry: LspLogEntry): void;
  activeFilePath(): string | null;
  previewRootPath(): string | null;
  previewMainPath(): string | null;
  setToolchainStatus(status: ToolchainStatus): void;
  clearPreview(): void;
  initializeLsp(shouldConnect: boolean): Promise<void>;
  reactivateFile(path: string): Promise<void>;
}

/** Owns application-level Tinymist client wiring and session reset integration. */
export class TinymistIntegrationController {
  constructor(private readonly deps: TinymistIntegrationDependencies) {}

  createClient(): TinymistLspClient {
    const client = new TinymistLspClient(
      () => this.deps.workspaceRootPath(),
      () => {},
      status => this.deps.setLspStatus(status),
      (uri, position) => this.deps.handleInverseSync(uri, position),
      (uri, diagnostics, version) => this.deps.handleDiagnostics(uri, diagnostics, version),
      entry => this.deps.appendLspLog(entry),
      items => this.deps.updateOutlinePreviewPositions(items),
      context => this.handlePreviewStartupFailure(context),
    );
    client.setEditorView(this.deps.editor());
    return client;
  }

  onConnected(): void {
    void this.deps.discoverSurroundWithOptions();
    this.deps.resetSourceMap({ retry: false });
  }

  resetSessionState(): void {
    this.deps.resetSurroundWithDiscovery();
    this.deps.setLspReady(false);
    this.deps.resetLspDocuments();
    this.deps.clearPendingLspSync();
    this.deps.clearForwardSync();
    this.deps.clearDiagnostics();
    this.deps.resetSourceMap();
    this.deps.clearSourceMapWarmup();
    this.deps.resetPdfSourceMapIdentity();
  }

  handlePreviewStartupFailure(context: PreviewStartupFailureContext): void {
    this.deps.resetSourceMapIfTaskFailed(context.taskId);
    this.deps.appendDeveloperLog({
      kind: "error",
      source: "preview startup",
      message: [
        `Tinymist preview startup failed: ${context.message}`,
        `root=${context.path}`,
        `task=${context.taskId}`,
        `mode=${context.refreshStyle}`,
        `partialRendering=${context.partialRendering}`,
        `active=${this.deps.activeFilePath() ?? "n/a"}`,
        `previewRoot=${this.deps.previewRootPath() ?? "n/a"}`,
        `previewMain=${this.deps.previewMainPath() ?? "n/a"}`,
      ].join("; "),
    });
  }

  async handleToolchainChanged(status: ToolchainStatus): Promise<void> {
    this.deps.setToolchainStatus(status);
    this.deps.setLspReady(false);
    this.deps.resetSourceMap({ retry: false });
    this.deps.resetLspDocuments();
    this.deps.clearPreview();
    await this.deps.initializeLsp(status.lspAvailable);
    const activePath = this.deps.activeFilePath();
    if (activePath) await this.deps.reactivateFile(activePath);
  }
}
