import type { Extension, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { forceParsing } from "@codemirror/language";
import type { EditorFontManager } from "./fontManager";
import type { EditorToolbarController } from "./toolbarController";
import type { EditorTab } from "./editorTab";
import type { ImagePreviewController } from "../preview/imagePreviewController";
import type { PreviewFrame } from "../preview/previewFrame";
import { isBinaryImagePath } from "../platform/fileTypes";
import { completionCompartment, languageCompartment } from "./extensions";
import { createTabEditorState } from "./tabHistory";
import { prepareVisibleBracketColors } from "./bracketColorizer";

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
  private syntaxPresentationGeneration = 0;
  private pendingSyntaxPath: string | null = null;
  private syntaxPrewarmHandle: number | null = null;
  private syntaxPrewarmUsesIdleCallback = false;

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
    tab.editorState = undefined;
    tab.editorStateLanguage = undefined;
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
    const language = this.editorLanguageKey(path);
    const reusableState = tab.editorState?.doc.toString() === tab.content
      && tab.editorStateLanguage === language
      ? tab.editorState
      : undefined;
    let nextState = reusableState ?? createTabEditorState({
        doc: tab.content,
        anchor: tab.selectionAnchor,
        head: tab.selectionHead,
        extensions: this.deps.editorExtensions(),
        undoHistory: tab.undoHistory,
      });
    nextState = nextState.update({
      effects: [
        ...this.deps.currentSettingsEffects(),
        ...(editorFontEffect ? [editorFontEffect] : []),
        ...(reusableState
          ? []
          : [languageCompartment.reconfigure(this.deps.editorLanguageForPath(path))]),
        completionCompartment.reconfigure(this.deps.editorCompletionForPath(path)),
      ],
    }).state;

    this.cancelSyntaxPrewarm();
    ++this.syntaxPresentationGeneration;
    // View plugins (including bracket colors) are recreated by setState even
    // when the immutable syntax state is retained. Keep the next tab hidden
    // until its restored viewport has both syntax and bracket decorations.
    if (ext === "typ") {
      editor.dom.classList.add("editor-syntax-preparing");
      this.pendingSyntaxPath = path;
    } else {
      editor.dom.classList.remove("editor-syntax-preparing");
      this.pendingSyntaxPath = null;
    }
    editor.setState(nextState);
    tab.editorState = nextState;
    tab.editorStateLanguage = language;
  }

  finishTextPresentation(path: string): void {
    if (this.pendingSyntaxPath !== path) return;
    this.revealAfterVisibleSyntaxIsReady(this.deps.editor(), this.syntaxPresentationGeneration);
  }
  presentEmpty(): void {
    const editor = this.deps.editor();
    this.cancelSyntaxPrewarm();
    ++this.syntaxPresentationGeneration;
    this.pendingSyntaxPath = null;
    editor.dom.classList.remove("editor-syntax-preparing");
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

  private revealAfterVisibleSyntaxIsReady(editor: EditorView, generation: number): void {
    const attempt = () => {
      if (generation !== this.syntaxPresentationGeneration) return;
      const visibleTo = editor.visibleRanges.reduce(
        (maximum, range) => Math.max(maximum, range.to),
        editor.state.selection.main.head,
      );
      const syntaxReady = forceParsing(editor, visibleTo, 24);
      const bracketsReady = syntaxReady && prepareVisibleBracketColors(editor);
      if (!syntaxReady || !bracketsReady) {
        requestAnimationFrame(attempt);
        return;
      }
      requestAnimationFrame(() => {
        if (generation !== this.syntaxPresentationGeneration) return;
        this.pendingSyntaxPath = null;
        editor.dom.classList.remove("editor-syntax-preparing");
        this.scheduleSyntaxPrewarm(editor, generation, visibleTo);
      });
    };
    requestAnimationFrame(attempt);
  }

  /**
   * Continue parsing a large Typst document only while the WebView is idle.
   * This makes later distant jumps progressively warmer without delaying the
   * viewport that the user can currently see or running an unbounded task.
   */
  private scheduleSyntaxPrewarm(editor: EditorView, generation: number, parsedTo: number): void {
    if (parsedTo >= editor.state.doc.length || generation !== this.syntaxPresentationGeneration) return;

    const runSlice = (availableMs: number) => {
      this.syntaxPrewarmHandle = null;
      if (generation !== this.syntaxPresentationGeneration || !editor.dom.isConnected) return;

      const nextTarget = Math.min(editor.state.doc.length, parsedTo + 64 * 1024);
      const budget = Math.max(2, Math.min(8, availableMs));
      forceParsing(editor, nextTarget, budget);
      this.scheduleSyntaxPrewarm(editor, generation, nextTarget);
    };

    if (typeof window.requestIdleCallback === "function") {
      this.syntaxPrewarmUsesIdleCallback = true;
      this.syntaxPrewarmHandle = window.requestIdleCallback(deadline => {
        if (deadline.timeRemaining() < 2 && !deadline.didTimeout) {
          this.scheduleSyntaxPrewarm(editor, generation, parsedTo);
          return;
        }
        runSlice(deadline.timeRemaining() || 2);
      }, { timeout: 1_000 });
      return;
    }

    this.syntaxPrewarmUsesIdleCallback = false;
    this.syntaxPrewarmHandle = window.setTimeout(() => runSlice(4), 250);
  }

  private cancelSyntaxPrewarm(): void {
    if (this.syntaxPrewarmHandle === null) return;
    if (this.syntaxPrewarmUsesIdleCallback && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(this.syntaxPrewarmHandle);
    } else {
      window.clearTimeout(this.syntaxPrewarmHandle);
    }
    this.syntaxPrewarmHandle = null;
  }

  private editorLanguageKey(path: string): string {
    const fileName = path.replace(/\\/gu, "/").split("/").pop() ?? path;
    const extensionIndex = fileName.lastIndexOf(".");
    return extensionIndex >= 0 ? fileName.slice(extensionIndex + 1).toLowerCase() : "";
  }

}
