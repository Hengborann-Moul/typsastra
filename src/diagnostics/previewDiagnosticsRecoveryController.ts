import type { LspDiagnostic } from "../compiler/lsp";
import type { PreviewFrame } from "../preview/previewFrame";
import { activeFileCanRenderPreview } from "../preview/previewPolicy";
import type { PreviewRenderMode } from "../settings";
import { fileNameFromPath } from "../platform/paths";

export interface PreviewDiagnosticsRecoveryDependencies {
  activeFilePath(): string | null;
  pinnedMainFilePath(): string | null;
  previewImported(): boolean;
  previewDisabled(): boolean;
  renderMode(): PreviewRenderMode;
  editorText(): string;
  previewFrame(): PreviewFrame;
  renderPdfPreview(contents: string): void;
  log(message: string): void;
}

/** Owns preview failure bookkeeping and recovery after accepted LSP diagnostics. */
export class PreviewDiagnosticsRecoveryController {
  private failedContents: string | null = null;
  private lastRequestedContents: string | null = null;

  constructor(private readonly deps: PreviewDiagnosticsRecoveryDependencies) {}

  onRenderSucceeded(): void {
    this.failedContents = null;
    this.lastRequestedContents = null;
  }

  onRenderFailed(contents: string): void {
    this.failedContents = contents;
    this.lastRequestedContents = null;
  }

  recoverAfterAcceptedDiagnostics(diagnostics: readonly LspDiagnostic[]): void {
    const errors = diagnostics.filter(diagnostic => diagnostic.severity === 1);
    const canRenderActiveFile = this.canRenderActiveFile();
    if (errors.length > 0) {
      if (canRenderActiveFile && this.failedContents === null) {
        this.deps.previewFrame().setError(
          "Preview Render Failed",
          this.failureMessage(errors),
        );
      }
      return;
    }

    // Diagnostic overlays are provisional and may be removed as soon as the
    // active revision is valid. Compiler failures are owned by the render
    // pipeline and must remain visible until a later PDF presents successfully.
    if (canRenderActiveFile && this.failedContents === null) {
      this.deps.previewFrame().clearErrorOverlay();
    }

    if (this.deps.renderMode() !== "on-type" || this.failedContents === null) return;

    const latestContents = this.deps.editorText();
    if (
      latestContents === this.failedContents
      || latestContents === this.lastRequestedContents
      || !this.canRenderActiveFile()
    ) return;

    this.lastRequestedContents = latestContents;
    this.deps.log(
      `LSP accepted a corrected revision after preview failure; requeueing ${latestContents.length} UTF-16 code unit(s).`,
    );
    this.deps.renderPdfPreview(latestContents);
  }

  private canRenderActiveFile(): boolean {
    return activeFileCanRenderPreview(
      this.deps.activeFilePath(),
      this.deps.pinnedMainFilePath(),
      this.deps.previewImported(),
      this.deps.previewDisabled(),
    );
  }

  private failureMessage(diagnostics: readonly LspDiagnostic[]): string {
    const activeFileName = this.deps.activeFilePath()
      ? fileNameFromPath(this.deps.activeFilePath()!)
      : "document";
    const visible = diagnostics.slice(0, 8).map(diagnostic => {
      const line = diagnostic.range.start.line + 1;
      const column = (diagnostic.range.start.character ?? 0) + 1;
      return `error: ${diagnostic.message}\n  └─ ${activeFileName}:${line}:${column}`;
    });
    if (diagnostics.length > visible.length) {
      visible.push(`…and ${diagnostics.length - visible.length} more error(s).`);
    }
    return visible.join("\n\n");
  }
}
