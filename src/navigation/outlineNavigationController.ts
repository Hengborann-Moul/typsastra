import { EditorView } from "@codemirror/view";
import type { DocumentHeading, DocumentOutlineController } from "../outline/documentOutline";
import type { EditorTab } from "../editor/editorTab";
import type { PreviewFrame } from "../preview/previewFrame";
import type { PreviewSyncController } from "../preview/previewSyncController";

export interface OutlineNavigationDependencies {
  activeTab(): EditorTab | null;
  activeFilePath(): string | null;
  activeMode(): "CODE" | "WYSIWYM";
  promoteToPermanent(tab: EditorTab): Promise<void> | void;
  loadFile(path: string, options: { focusEditor?: boolean }): Promise<void>;
  activeTabContentLoaded(): boolean;
  switchToCodeMode(): void;
  outline(): DocumentOutlineController;
  previewSync(): PreviewSyncController;
  previewFrame(): PreviewFrame;
  editor(): EditorView;
}

/** Owns editor/preview navigation when selecting a document outline heading. */
export class OutlineNavigationController {
  constructor(private readonly deps: OutlineNavigationDependencies) {}

  async navigate(heading: DocumentHeading): Promise<void> {
    const activeTab = this.deps.activeTab();
    if (activeTab?.temporary) void this.deps.promoteToPermanent(activeTab);

    if (heading.filePath !== this.deps.activeFilePath()) {
      await this.deps.loadFile(heading.filePath, { focusEditor: false });
    }
    if (!this.deps.activeTabContentLoaded()) return;
    if (this.deps.activeMode() === "WYSIWYM") this.deps.switchToCodeMode();

    const outline = this.deps.outline();
    const currentHeading = outline.findHeading(heading.id) ?? heading;
    const editor = this.deps.editor();
    const cursor = Math.max(0, Math.min(currentHeading.textFrom, editor.state.doc.length));
    this.deps.previewSync().clearForward();
    editor.dispatch({
      selection: { anchor: cursor },
      effects: EditorView.scrollIntoView(cursor, { y: "start", yMargin: 28 }),
    });
    outline.setCursorPosition(cursor, this.deps.activeFilePath());
    if (currentHeading.previewPosition) {
      this.deps.previewFrame().scrollToPage(currentHeading.previewPosition.page_no);
    } else {
      const previewPos = outline.previewPositionAt(cursor);
      if (previewPos) this.deps.previewFrame().scrollToPage(previewPos.page_no);
    }
  }
}
