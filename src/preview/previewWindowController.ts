import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyUIThemeVariables } from "../editor/extensions";
import type { ThemeName } from "../settings";
import type { PdfUpdatePayload } from "./pdfPreviewRenderController";
import type { DraftPreviewController } from "./draftPreviewController";
import type { PreviewFrame } from "./previewFrame";

export type UndockedPreviewAction = "export-pdf" | "open-external";

export interface PreviewWindowDependencies {
  loadSettings(): Promise<void>;
  theme(): ThemeName;
  previewFrame: PreviewFrame;
  draftPreview: DraftPreviewController;
  zoomIn(): void;
  zoomOut(): void;
  zoomToFit(): void;
  initializePreviewPageControls(): void;
  sourceMapRootPath(): string | null;
  previewRootPath(): string | null;
  setWorkspaceRootPath(path: string | null): void;
  loadPdfPath(path: string, identity: string, sessionKey: string, surface: PdfUpdatePayload["surface"]): void;
}

export class PreviewWindowController {
  constructor(private readonly deps: PreviewWindowDependencies) {}

  isPreviewOnlyWindow(): boolean {
    return new URLSearchParams(window.location.search).get("mode") === "preview";
  }

  async bootstrap(): Promise<void> {
    const deps = this.deps;
    document.documentElement.classList.add("preview-only-mode");
    document.body.classList.add("preview-only-mode");

    await deps.loadSettings();
    await applyUIThemeVariables(deps.theme());
    deps.previewFrame.syncTheme();

    document.getElementById("preview-zoom-in-btn")?.addEventListener("click", () => deps.zoomIn());
    document.getElementById("preview-zoom-out-btn")?.addEventListener("click", () => deps.zoomOut());
    document.getElementById("preview-zoom-fit-btn")?.addEventListener("click", () => deps.zoomToFit());
    deps.initializePreviewPageControls();

    const undockBtn = document.getElementById("undock-preview-btn");
    if (undockBtn) {
      undockBtn.title = "Dock Preview";
      undockBtn.addEventListener("click", () => { void getCurrentWindow().close(); });
    }

    const previewWrapper = document.getElementById("preview-container-wrapper");
    if (previewWrapper) {
      previewWrapper.classList.remove("hidden");
      previewWrapper.style.display = "flex";
      previewWrapper.style.width = "100%";
      previewWrapper.style.height = "100%";
    }

    await getCurrentWindow().show();

    const { listen, emit } = await import("@tauri-apps/api/event");
    this.initializeOptions(action => emit("preview-window-action", action));

    document.getElementById("preview-content-mode-toggle")?.addEventListener("click", () => {
      const requestedMode = deps.draftPreview.mode === "draft" ? "normal" : "draft";
      deps.draftPreview.setMode(requestedMode);
      deps.draftPreview.updateControl(true);
      void emit("preview-content-mode-request", requestedMode);
    });

    await listen<ThemeName>("preview-theme-update", event => {
      void applyUIThemeVariables(event.payload).then(() => deps.previewFrame.syncTheme());
    });

    await listen<string | PdfUpdatePayload>("pdf-update", event => {
      const fallbackIdentity = deps.sourceMapRootPath() ?? deps.previewRootPath() ?? "preview";
      const update = typeof event.payload === "string"
        ? { path: event.payload, identity: fallbackIdentity, sessionKey: fallbackIdentity, surface: "live" as const }
        : event.payload;
      deps.draftPreview.installPresentedState({
        mode: update.contentMode ?? "normal",
        assets: update.draftAssets ?? [],
        assetRootPath: update.draftAssetRootPath ?? null,
        generation: update.draftThumbnailGeneration ?? 0,
      });
      deps.setWorkspaceRootPath(update.draftAssetRootPath ?? null);
      const toggle = document.getElementById("preview-content-mode-toggle") as HTMLButtonElement | null;
      toggle?.classList.remove("hidden");
      deps.loadPdfPath(update.path, update.identity, update.sessionKey, update.surface);
    });

    await listen<{ page_no: number; x: number; y: number }>("pdf-forward-sync", event => {
      void deps.previewFrame.revealDocumentPosition(event.payload);
    });

    void emit("preview-window-ready");
  }

  private initializeOptions(requestMainWindowAction: (action: UndockedPreviewAction) => Promise<void>): void {
    const deps = this.deps;
    const button = document.getElementById("preview-menu-btn");
    const menu = document.getElementById("context-menu");
    if (!button || !menu) return;

    const hide = () => {
      menu.style.display = "none";
      delete menu.dataset.menuKind;
    };
    const show = () => {
      menu.innerHTML = `
        <div class="dropdown-item" data-preview-action="zoom-out">Zoom Out</div>
        <div class="dropdown-item" data-preview-action="zoom-fit">Fit to Width</div>
        <div class="dropdown-item" data-preview-action="zoom-in">Zoom In</div>
        <div class="dropdown-separator"></div>
        <div class="dropdown-item" data-preview-action="export-pdf">Export PDF</div>
        <div class="dropdown-item" data-preview-action="open-external">Open in External Viewer</div>
        <div class="dropdown-separator"></div>
        <div class="dropdown-item" data-preview-action="dock">Dock Preview</div>`;
      menu.dataset.menuKind = "preview";
      menu.style.display = "block";
      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(0, Math.min(buttonRect.right - menuRect.width, window.innerWidth - menuRect.width))}px`;
      menu.style.top = `${Math.max(0, Math.min(buttonRect.bottom + 4, window.innerHeight - menuRect.height))}px`;
    };

    button.addEventListener("click", event => {
      event.stopPropagation();
      if (menu.style.display === "block" && menu.dataset.menuKind === "preview") hide();
      else show();
    });
    menu.addEventListener("click", event => {
      const action = (event.target as HTMLElement).closest<HTMLElement>("[data-preview-action]")?.dataset.previewAction;
      if (!action) return;
      hide();
      if (action === "zoom-out") deps.zoomOut();
      else if (action === "zoom-fit") deps.zoomToFit();
      else if (action === "zoom-in") deps.zoomIn();
      else if (action === "dock") document.getElementById("undock-preview-btn")?.click();
      else if (action === "export-pdf" || action === "open-external") void requestMainWindowAction(action);
    });
    document.addEventListener("click", hide);
    window.addEventListener("blur", hide);
    window.addEventListener("message", event => {
      const type = (event.data as { type?: unknown } | null)?.type;
      if (type === "HIDE_CONTEXT_MENU" || type === "SHOW_PREVIEW_CONTEXT_MENU") hide();
    });
  }
}
