import { workspaceViewportState } from "./workspaceVisibility";
import { WorkspaceWatcher, type WorkspaceChange } from "./workspaceWatcher";

export interface WorkspaceViewportInput {
  activeFilePath: string | null;
  workspaceRootPath: string | null;
  loading: boolean;
}

export interface WorkspaceControllerPort {
  dockPreview(): void;
  applySidebarVisibility(): void;
  pathKey(path: string): string;
  handleWorkspaceChange(change: WorkspaceChange): Promise<void>;
  reportWatchError(error: unknown): void;
}

/** Owns workspace-level viewport transitions and their DOM projection. */
export class WorkspaceController {
  private readonly watcher: WorkspaceWatcher;
  private readonly pendingChanges = new Map<string, WorkspaceChange>();
  private changeDrainRunning = false;

  constructor(private readonly port: WorkspaceControllerPort) {
    this.watcher = new WorkspaceWatcher(
      change => this.enqueueChange(change),
      error => this.port.reportWatchError(error),
    );
  }

  startWatching(rootPath: string): Promise<void> {
    return this.watcher.start(rootPath);
  }

  stopWatching(): void {
    this.watcher.stop();
    this.pendingChanges.clear();
  }

  public updateViewport(input: WorkspaceViewportInput): void {
    const welcomeScreen = document.getElementById("welcome-screen");
    const inputWrapper = document.getElementById("input-container-wrapper");
    const previewWrapper = document.getElementById("preview-container-wrapper");
    const resizer = document.getElementById("editor-preview-resizer");
    const explorerSidebar = document.getElementById("explorer-sidebar");
    const explorerResizer = document.getElementById("explorer-resizer");
    const sidebarActivityBar = document.getElementById("sidebar-activity-bar");
    const appMenus = document.getElementById("app-menus");
    const loading = document.getElementById("workspace-loading");
    const statusBar = document.getElementById("status-bar");
    const viewport = workspaceViewportState(
      input.activeFilePath,
      input.workspaceRootPath,
      input.loading,
    );

    loading?.classList.toggle("hidden", !viewport.showLoading);
    statusBar?.classList.toggle("welcome-screen-active", viewport.showWelcome);
    welcomeScreen?.classList.toggle("hidden", !viewport.showWelcome);

    inputWrapper?.classList.toggle("hidden", !viewport.showEditor);
    previewWrapper?.classList.toggle("hidden", !viewport.showEditor);
    resizer?.classList.toggle("hidden", !viewport.showEditor);
    if (viewport.showEditor) this.port.dockPreview();

    if (viewport.showWorkspaceChrome) {
      sidebarActivityBar?.classList.remove("hidden");
      this.port.applySidebarVisibility();
      appMenus?.classList.remove("hidden");
      return;
    }

    explorerSidebar?.classList.add("hidden");
    explorerResizer?.classList.add("hidden");
    sidebarActivityBar?.classList.add("hidden");
    appMenus?.classList.add("hidden");
  }

  private enqueueChange(change: WorkspaceChange): void {
    const batchKey = `${this.port.pathKey(change.rootPath)}\u0000${change.kind}`;
    // Preserve the old/new pairing of independent rename events. Repeated
    // notifications for the same rename still collapse to one batch.
    const key = change.kind === "rename"
      ? `${batchKey}\u0000${change.paths.map(path => this.port.pathKey(path)).join("\u0000")}`
      : batchKey;
    const pending = this.pendingChanges.get(key);
    if (pending) {
      pending.paths = [...new Set([...pending.paths, ...change.paths])];
    } else {
      this.pendingChanges.set(key, {
        rootPath: change.rootPath,
        kind: change.kind,
        paths: [...new Set(change.paths)],
      });
    }
    if (!this.changeDrainRunning) void this.drainChanges();
  }

  private async drainChanges(): Promise<void> {
    if (this.changeDrainRunning) return;
    this.changeDrainRunning = true;
    try {
      while (this.pendingChanges.size > 0) {
        const changes = [...this.pendingChanges.values()];
        this.pendingChanges.clear();
        for (const change of changes) {
          try {
            await this.port.handleWorkspaceChange(change);
          } catch (error) {
            this.port.reportWatchError(error);
          }
        }
      }
    } finally {
      this.changeDrainRunning = false;
      if (this.pendingChanges.size > 0) void this.drainChanges();
    }
  }
}
