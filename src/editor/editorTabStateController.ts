import type { EditorView } from "@codemirror/view";
import { isBinaryImagePath, fileExtension } from "../platform/fileTypes";
import { filePathKey } from "../platform/paths";
import type { EditorFoldRange } from "./folding";
import type { EditorController } from "./editorController";
import type { EditorTab } from "./editorTab";
import { captureEditorUndoHistory } from "./tabHistory";

export interface EditorTabStateDependencies {
  editor(): EditorView;
  editorController(): EditorController;
  activeTab(): EditorTab | null;
  activeFilePath(): string | null;
  workspaceLoading(): boolean;
  activeMode(): "CODE" | "WYSIWYM";
  currentVersion(): number;
  latestDocumentVersion(): number;
  isInternallySupportedPath(path: string): boolean;
  flushEditorContentMutation(): void;
  wysiwymMarkup(): string;
  renderTabs(): void;
  saveWorkspaceState(): void | Promise<void>;
}

/** Owns persisted editor-tab state, viewport restoration, folds, and dirty promotion. */
export class EditorTabStateController {
  constructor(private readonly deps: EditorTabStateDependencies) {}

  async promoteToPermanent(tab: EditorTab): Promise<void> {
    if (!tab.temporary) return;
    tab.temporary = false;
    this.deps.renderTabs();
    await this.deps.saveWorkspaceState();
  }

  persistActive(): void {
    if (this.deps.workspaceLoading()) return;
    this.deps.flushEditorContentMutation();
    const tab = this.deps.activeTab();
    if (!tab || !tab.contentLoaded) return;
    if (!this.deps.isInternallySupportedPath(tab.path) || isBinaryImagePath(tab.path) || fileExtension(tab.path) === "pdf") return;

    const editor = this.deps.editor();
    const content = this.deps.activeMode() === "WYSIWYM"
      ? this.deps.wysiwymMarkup()
      : editor.state.doc.toString();
    const selection = editor.state.selection.main;
    tab.content = content;
    tab.isDirty = tab.content !== tab.savedContent;
    tab.version = this.deps.currentVersion();
    tab.latestVersion = this.deps.latestDocumentVersion();
    tab.selectionAnchor = selection.anchor;
    tab.selectionHead = selection.head;
    tab.scrollTop = editor.scrollDOM.scrollTop;
    tab.scrollLeft = editor.scrollDOM.scrollLeft;
    tab.scrollSnapshot = editor.scrollSnapshot();
    tab.foldRanges = tab.foldStateExplicit ? this.collectCurrentFoldRanges() : [];
    tab.undoHistory = captureEditorUndoHistory(editor.state);
  }

  collectCurrentFoldRanges(): EditorFoldRange[] {
    return this.deps.editorController().collectFoldRanges();
  }

  restoreViewport(tab: EditorTab, path: string): void {
    const editor = this.deps.editor();
    if (tab.scrollSnapshot) {
      editor.dispatch({ effects: tab.scrollSnapshot });
      return;
    }
    if (tab.scrollTop === undefined && tab.scrollLeft === undefined) return;

    const targetScrollTop = tab.scrollTop ?? 0;
    const targetScrollLeft = tab.scrollLeft ?? 0;
    const restoreKey = { restoredPath: path };
    const scheduleRestore = () => {
      editor.requestMeasure({
        key: restoreKey,
        read: () => null,
        write: () => {
          const activeFilePath = this.deps.activeFilePath();
          if (!activeFilePath || filePathKey(activeFilePath) !== filePathKey(path)) return;
          editor.scrollDOM.scrollTop = targetScrollTop;
          editor.scrollDOM.scrollLeft = targetScrollLeft;
        },
      });
    };
    scheduleRestore();
    requestAnimationFrame(scheduleRestore);
  }

  restoreFoldState(tab: EditorTab): void {
    tab.foldRanges = this.deps.editorController().restoreFoldState(
      tab.foldStateExplicit,
      tab.foldRanges,
    );
  }

  updateActiveContent(content: string): void {
    const tab = this.deps.activeTab();
    if (!tab) return;
    const wasDirty = tab.isDirty;
    tab.content = content;
    tab.isDirty = tab.content !== tab.savedContent;
    if (tab.isDirty && tab.temporary) {
      void this.promoteToPermanent(tab);
    } else if (wasDirty !== tab.isDirty) {
      this.deps.renderTabs();
    }
  }

  markActiveDirty(): void {
    const tab = this.deps.activeTab();
    if (!tab) return;
    const wasDirty = tab.isDirty;
    tab.isDirty = true;
    if (tab.temporary) {
      void this.promoteToPermanent(tab);
    } else if (!wasDirty) {
      this.deps.renderTabs();
    }
  }
}
