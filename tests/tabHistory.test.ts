import { describe, expect, test } from "bun:test";
import { history, undo } from "@codemirror/commands";
import {
  captureEditorUndoHistory,
  createTabEditorState,
  type EditorUndoHistory,
} from "../src/editor/tabHistory";

function edit(
  doc: string,
  insert: string,
  undoHistory?: EditorUndoHistory,
) {
  let state = createTabEditorState({
    doc,
    anchor: doc.length,
    head: doc.length,
    extensions: history(),
    undoHistory,
  });
  state = state.update({
    changes: { from: state.doc.length, insert },
    userEvent: "input.type",
  }).state;
  return state;
}

function undoState(state: ReturnType<typeof edit>) {
  let current = state;
  const applied = undo({
    state: current,
    dispatch: transaction => {
      current = transaction.state;
    },
  });
  return { applied, state: current };
}

describe("per-tab editor history", () => {
  test("restores undo independently after switching between documents", () => {
    const first = edit("first", " A");
    const second = edit("second", " B");

    const restoredFirst = createTabEditorState({
      doc: first.doc.toString(),
      anchor: first.selection.main.anchor,
      head: first.selection.main.head,
      extensions: history(),
      undoHistory: captureEditorUndoHistory(first),
    });
    const firstUndo = undoState(restoredFirst);
    expect(firstUndo.applied).toBe(true);
    expect(firstUndo.state.doc.toString()).toBe("first");

    const restoredSecond = createTabEditorState({
      doc: second.doc.toString(),
      anchor: second.selection.main.anchor,
      head: second.selection.main.head,
      extensions: history(),
      undoHistory: captureEditorUndoHistory(second),
    });
    const secondUndo = undoState(restoredSecond);
    expect(secondUndo.applied).toBe(true);
    expect(secondUndo.state.doc.toString()).toBe("second");
  });

  test("starts with an empty undo stack when no history was captured", () => {
    const state = createTabEditorState({
      doc: "untouched",
      anchor: 0,
      head: 0,
      extensions: history(),
    });
    expect(undoState(state).applied).toBe(false);
  });

  test("the workspace captures and restores history at tab boundaries", async () => {
    const stateSource = await Bun.file(
      new URL("../src/editor/editorTabStateController.ts", import.meta.url),
    ).text();
    const presentationSource = await Bun.file(
      new URL("../src/editor/editorTabPresentationController.ts", import.meta.url),
    ).text();
    const capture = stateSource.indexOf("tab.undoHistory = captureEditorUndoHistory(editor.state)");
    const restore = presentationSource.indexOf("editor.setState(createTabEditorState({");
    const restoredHistory = presentationSource.indexOf("undoHistory: tab.undoHistory", restore);

    expect(capture).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(-1);
    expect(restoredHistory).toBeGreaterThan(restore);
    expect(stateSource).not.toContain("Transaction.addToHistory.of(false)");
    expect(presentationSource).not.toContain("Transaction.addToHistory.of(false)");
  });

  test("tab switches restore a document-aware scroll snapshot before asynchronous typography work", async () => {
    const activationSource = await Bun.file(new URL("../src/editor/editorTabActivationController.ts", import.meta.url)).text();
    const stateSource = await Bun.file(
      new URL("../src/editor/editorTabStateController.ts", import.meta.url),
    ).text();
    const capture = stateSource.indexOf("tab.scrollSnapshot = editor.scrollSnapshot()");
    const restoreOwned = stateSource.indexOf("if (tab.scrollSnapshot)");
    const activation = activationSource.indexOf("async activate(");
    const restore = activationSource.indexOf("deps.restoreEditorTabViewport(tab, path)", activation);
    const typography = activationSource.indexOf("await deps.typography.effective(path, tab.content)", activation);

    expect(capture).toBeGreaterThan(-1);
    expect(restoreOwned).toBeGreaterThan(capture);
    expect(restore).toBeGreaterThan(activation);
    expect(restore).toBeLessThan(typography);
  });
});
