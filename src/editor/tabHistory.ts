import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { historyField } from "@codemirror/commands";

export type EditorUndoHistory = unknown;

export function captureEditorUndoHistory(state: EditorState): EditorUndoHistory | undefined {
  return state.field(historyField, false);
}

export function createTabEditorState(options: {
  doc: string;
  anchor: number;
  head: number;
  extensions: Extension;
  undoHistory?: EditorUndoHistory;
}): EditorState {
  const docLength = options.doc.length;
  const anchor = Math.max(0, Math.min(options.anchor, docLength));
  const head = Math.max(0, Math.min(options.head, docLength));
  return EditorState.create({
    doc: options.doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [
      options.extensions,
      options.undoHistory === undefined
        ? []
        : historyField.init(() => options.undoHistory),
    ],
  });
}
