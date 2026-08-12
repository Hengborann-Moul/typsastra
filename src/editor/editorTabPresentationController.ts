import type { Extension, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { EditorFontManager } from "./fontManager";
import type { EditorToolbarController } from "./toolbarController";
import type { EditorTab } from "./editorTab";
import type { ImagePreviewController } from "../preview/imagePreviewController";
import type { PreviewFrame } from "../preview/previewFrame";
import { isBinaryImagePath } from "../platform/fileTypes";
import { completionCompartment, languageCompartment } from "./extensions";
import { createTabEditorState } from "./tabHistory";

export interface EditorTabPresentationDependencies {
  editor(): EditorView;
  editorExtensions(): Extension;
  currentSettingsEffects(): readonly StateEffect<unknown>[];
  editorLanguageForPath(path: string): Extension;
  editorCompletionForPath(path: string): Extension;
  fontManager(): EditorFontManager;
  toolbar(): EditorToolbarController;
  imagePreview(): ImagePreviewController;
  previewFrame(): PreviewFrame;
  activeMode(): "CODE" | "WYSIWYM";
  updatePreviewActionsToolbar(path: string): void;
  renderNonTextPlaceholder(path: string, unsupported: boolean): void;
  renderInteractiveImageViewer(source: string): void;
  loadPdfPath(path: string): void;
  applyFoldRanges(ranges: { from: number; to: number }[]): void;
  clearPreviewPane(): void;
  clearOutline(): void;
  mapMarkupToWysiwym(contents: string): void;
}

/** Owns editor/preview DOM presentation while a tab is being activated. */
export class EditorTabPresentationController {
  private loading = false;

  constructor(private readonly deps: EditorTabPresentationDependencies) {}

  get isLoading(): boolean { return this.loading; }
  set isLoading(value: boolean) { this.loading = value; }

  showImageLoading(path: string): void {
    this.deps.imagePreview().clear();
    this.deps.updatePreviewActionsToolbar(path);
    this.deps.previewFrame().setLoading("Preparing image preview…", false);
  }

  presentNonText(
    tab: EditorTab,
    path: string,
    unsupportedFile: boolean,
    isPdf: boolean,
    skipPreviewActivation: boolean,
    beforePreviewActivation: () => void,
  ): void {
    const codeRenderPane = document.getElementById("code-render-pane");
    const imageViewerPane = document.getElementById("image-viewer-pane");
    const imageViewerImg = document.getElementById("image-viewer-img") as HTMLImageElement | null;

    codeRenderPane?.classList.add("hidden");
    imageViewerPane?.classList.remove("hidden");
    if (imageViewerImg) imageViewerImg.style.display = "none";
    this.deps.renderNonTextPlaceholder(path, unsupportedFile);
    document.getElementById("wysiwym-editor-pane")?.classList.add("hidden");
    this.deps.imagePreview().clear();
    beforePreviewActivation();

    if (!skipPreviewActivation) {
      this.deps.updatePreviewActionsToolbar(path);
      if (isBinaryImagePath(path)) {
        this.deps.renderInteractiveImageViewer(tab.content);
      } else if (isPdf) {
        this.deps.loadPdfPath(path);
      } else {
        this.deps.previewFrame().setMessage(
          `<div class="preview-disabled-placeholder">` +
          `<div class="preview-disabled-title">Preview Unavailable</div>` +
          `<div class="preview-disabled-msg">Open this file with its system application to view it.</div>` +
          `</div>`,
        );
      }
    }
    this.deps.toolbar().setDisabled(true);
  }

  replaceActiveTextContents(tab: EditorTab, contents: string): void {
    const editor = this.deps.editor();
    const selection = editor.state.selection.main;
    this.loading = true;
    try {
      const editorFontEffect = this.deps.fontManager().prepareDocument(contents);
      editor.setState(createTabEditorState({
        doc: contents,
        anchor: Math.min(selection.anchor, contents.length),
        head: Math.min(selection.head, contents.length),
        extensions: this.deps.editorExtensions(),
      }));
      editor.dispatch({
        effects: [
          ...this.deps.currentSettingsEffects(),
          ...(editorFontEffect ? [editorFontEffect] : []),
          languageCompartment.reconfigure(this.deps.editorLanguageForPath(tab.path)),
          completionCompartment.reconfigure(this.deps.editorCompletionForPath(tab.path)),
        ],
      });
    } finally {
      this.loading = false;
    }
  }

  presentText(tab: EditorTab, path: string): void {
    const codeRenderPane = document.getElementById("code-render-pane");
    const imageViewerPane = document.getElementById("image-viewer-pane");
    const imageViewerImg = document.getElementById("image-viewer-img") as HTMLImageElement | null;

    this.deps.imagePreview().clear();
    this.deps.updatePreviewActionsToolbar(path);
    codeRenderPane?.classList.remove("hidden");
    imageViewerPane?.classList.add("hidden");
    if (imageViewerImg) imageViewerImg.style.display = "block";
    if (this.deps.activeMode() === "WYSIWYM") {
      document.getElementById("wysiwym-editor-pane")?.classList.remove("hidden");
    }

    const ext = path.split(".").pop()?.toLowerCase();
    if (ext === "typ") {
      this.deps.toolbar().setDisabled(false);
    } else {
      this.deps.toolbar().setDisabled(true);
      if (ext === "md" || ext === "markdown") {
        // Markdown owns an overlay renderer. Leave the persistent PDF
        // presentation underneath untouched so returning to Typst is instant.
      } else if (ext === "svg") {
        this.deps.previewFrame().setMessageOverlay(
          `<div style="display:flex;align-items:center;justify-content:center;height:100%;width:100%;background:var(--ui-bg);box-sizing:border-box;padding:20px;overflow:auto;">` +
          tab.content +
          `</div>`,
        );
      } else {
        this.deps.previewFrame().setMessageOverlay(
          `<div class="preview-disabled-placeholder">` +
          `<div class="preview-disabled-icon">🚫</div>` +
          `<div class="preview-disabled-title">Preview Unavailable</div>` +
          `<div class="preview-disabled-msg">Live preview is not supported for ${ext?.toUpperCase() || "this"} files.</div>` +
          `</div>`,
        );
      }
    }

    const editorFontEffect = this.deps.fontManager().prepareDocument(tab.content);
    const editor = this.deps.editor();
    editor.setState(createTabEditorState({
      doc: tab.content,
      anchor: tab.selectionAnchor,
      head: tab.selectionHead,
      extensions: this.deps.editorExtensions(),
      undoHistory: tab.undoHistory,
    }));
    editor.dispatch({
      effects: [
        ...this.deps.currentSettingsEffects(),
        ...(editorFontEffect ? [editorFontEffect] : []),
        languageCompartment.reconfigure(this.deps.editorLanguageForPath(path)),
        completionCompartment.reconfigure(this.deps.editorCompletionForPath(path)),
      ],
    });
  }
  presentEmpty(): void {
    const editor = this.deps.editor();
    this.loading = true;
    try {
      editor.setState(createTabEditorState({
        doc: "",
        anchor: 0,
        head: 0,
        extensions: this.deps.editorExtensions(),
      }));
      editor.dispatch({ effects: this.deps.currentSettingsEffects() });
      this.deps.applyFoldRanges([]);
    } finally {
      this.loading = false;
    }
    this.deps.clearPreviewPane();
    this.deps.previewFrame().clear();
    this.deps.fontManager().updateDocument("");
    this.deps.clearOutline();
    if (this.deps.activeMode() === "WYSIWYM") {
      this.deps.mapMarkupToWysiwym("");
    }
  }

}
