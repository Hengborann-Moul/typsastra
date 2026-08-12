type WorkspaceResumeLogKind = "log" | "info" | "error";

type WorkspaceResumeDependencies = {
  canDeferWordWrap: () => boolean;
  disableWordWrap: () => void;
  restoreWordWrap: () => void;
  suspendPreviewResize: () => void;
  resumePreviewResize: () => void;
  recoverInterruptedResize: () => boolean;
  hasActiveWorkspaceDocument: () => boolean;
  cancelManualForwardSync: () => void;
  resetSourceMap: () => void;
  restoreEditorFonts: () => Promise<void>;
  rehydratePreviewAndSidebar: () => void;
  remeasureWorkspace: (reason: string) => void;
  canWarmSourceMap: () => boolean;
  warmSourceMap: () => void;
  log: (kind: WorkspaceResumeLogKind, source: string, message: string) => void;
};

export class WorkspaceResumeController {
  private recoveryActive = false;
  private horizontalResizeActive = false;
  private wordWrapDeferred = false;
  private readonly horizontalResizeWaiters = new Set<() => void>();

  constructor(private readonly deps: WorkspaceResumeDependencies) {}

  get interactionBlocked(): boolean {
    return this.horizontalResizeActive;
  }

  beginHorizontalResize(): void {
    this.horizontalResizeActive = true;
    this.deps.suspendPreviewResize();
    this.deferWordWrap();
  }

  endHorizontalResize(): void {
    this.horizontalResizeActive = false;
    for (const resolve of this.horizontalResizeWaiters) resolve();
    this.horizontalResizeWaiters.clear();
    this.restoreWordWrap();
    this.deps.resumePreviewResize();
  }

  waitForHorizontalResizeEnd(): Promise<void> {
    if (!this.horizontalResizeActive) return Promise.resolve();
    return new Promise(resolve => this.horizontalResizeWaiters.add(resolve));
  }

  async recoverAfterSystemResume(suspendedMs: number): Promise<void> {
    if (this.recoveryActive) {
      this.deps.log(
        "log",
        "workspace",
        "Ignored a duplicate system-resume recovery while the workspace was already being restored.",
      );
      return;
    }
    this.recoveryActive = true;
    const showRecoveryCover = this.deps.hasActiveWorkspaceDocument();
    if (showRecoveryCover) document.body.classList.add("typsastra-resume-recovering");

    const interruptedResize = this.deps.recoverInterruptedResize();
    if (this.horizontalResizeActive) this.endHorizontalResize();
    this.deps.cancelManualForwardSync();
    this.deps.resetSourceMap();

    try {
      await this.deps.restoreEditorFonts();
      this.deps.resumePreviewResize();
      this.deps.rehydratePreviewAndSidebar();

      await this.waitForLayoutFrames();
      this.deps.remeasureWorkspace("system resume");
      await new Promise<void>(resolve => window.setTimeout(resolve, 160));
      await this.waitForLayoutFrames();
      this.deps.remeasureWorkspace("system resume settling");

      if (this.deps.canWarmSourceMap()) this.deps.warmSourceMap();
      this.deps.log(
        "info",
        "workspace",
        `Recovered after system resume (${Math.round(suspendedMs / 1000)}s suspended); interruptedResize=${interruptedResize}.`,
      );
    } catch (error) {
      this.deps.log(
        "error",
        "workspace",
        `System-resume workspace recovery failed: ${String(error)}`,
      );
    } finally {
      document.body.classList.remove("typsastra-resume-recovering");
      this.recoveryActive = false;
    }
  }

  private deferWordWrap(): void {
    if (this.wordWrapDeferred || !this.deps.canDeferWordWrap()) return;
    this.wordWrapDeferred = true;
    this.deps.disableWordWrap();
  }

  private restoreWordWrap(): void {
    if (!this.wordWrapDeferred) return;
    this.wordWrapDeferred = false;
    this.deps.restoreWordWrap();
  }

  private waitForLayoutFrames(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }
}
