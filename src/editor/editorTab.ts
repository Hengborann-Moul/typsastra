import type { EditorView } from "@codemirror/view";
import type { EditorFoldRange } from "./folding";
import type { EditorUndoHistory } from "./tabHistory";

export type EditorTab = {
  path: string;
  content: string;
  savedContent: string;
  contentLoaded: boolean;
  isDirty: boolean;
  previewRootPath: string | null;
  previewMainPath: string | null;
  previewTaskId: string | null;
  previewSessionKey: string | null;
  previewImported: boolean;
  previewStandalone: boolean;
  previewDisabled: boolean;
  version: number;
  latestVersion: number;
  selectionAnchor: number;
  selectionHead: number;
  scrollTop?: number;
  scrollLeft?: number;
  scrollSnapshot?: ReturnType<EditorView["scrollSnapshot"]>;
  foldRanges: EditorFoldRange[] | null;
  foldStateExplicit: boolean;
  sizeBytes?: number;
  lineCount?: number;
  temporary?: boolean;
  undoHistory?: EditorUndoHistory;
};

export type PreviewSessionState = Pick<
  EditorTab,
  "previewRootPath" | "previewMainPath" | "previewTaskId" | "previewSessionKey" | "previewImported" | "previewStandalone" | "previewDisabled"
>;
