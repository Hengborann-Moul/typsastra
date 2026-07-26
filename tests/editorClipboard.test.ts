import { describe, expect, test } from "bun:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { selectedEditorClipboardText } from "../src/editor/extensions";

describe("editor clipboard", () => {
  test("returns selected text as a standard plain-text clipboard payload", () => {
    const state = EditorState.create({
      doc: "alpha\nខ្មែរ\nomega",
      selection: { anchor: 6, head: 11 },
    });

    expect(selectedEditorClipboardText(state)).toBe("ខ្មែរ");
  });

  test("joins multiple selections using the document line separator", () => {
    const state = EditorState.create({
      doc: "alpha beta gamma",
      selection: EditorSelection.create([
        EditorSelection.range(0, 5),
        EditorSelection.range(11, 16),
      ]),
      extensions: EditorState.allowMultipleSelections.of(true),
    });

    expect(selectedEditorClipboardText(state)).toBe("alpha\ngamma");
  });

  test("preserves native current-line copying when there is no selection", () => {
    const state = EditorState.create({
      doc: "alpha",
      selection: { anchor: 2 },
    });

    expect(selectedEditorClipboardText(state)).toBeNull();
  });
});
