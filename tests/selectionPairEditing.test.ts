import { describe, expect, test } from "bun:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  pairedSelectionContent,
  replaceSelectedDelimiters,
  type EditorOpeningDelimiter,
} from "../src/editor/selectionPairEditing";

function replace(
  doc: string,
  anchor: number,
  head: number,
  opening: EditorOpeningDelimiter,
): EditorState {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.range(anchor, head),
  });
  const view = {
    get state() { return state; },
    dispatch(transaction: ReturnType<EditorState["update"]>) { state = transaction.state; },
  } as unknown as EditorView;
  expect(replaceSelectedDelimiters(view, opening)).toBe(true);
  return state;
}

describe("selection pair editing", () => {
  test("recognizes every supported outer delimiter pair", () => {
    for (const selected of ['"Hello"', "[Hello]", "(Hello)", "{Hello}"]) {
      expect(pairedSelectionContent(selected)).toBe("Hello");
    }
    expect(pairedSelectionContent("Hello")).toBeNull();
    expect(pairedSelectionContent("[Hello)")).toBeNull();
  });

  test("replaces any existing pair with every supported pair type", () => {
    const cases: Array<[EditorOpeningDelimiter, string]> = [
      ['"', '"Hello"'],
      ["(", "(Hello)"],
      ["[", "[Hello]"],
      ["{", "{Hello}"],
    ];
    for (const source of ['"Hello"', "[Hello]", "(Hello)", "{Hello}"]) {
      for (const [opening, expected] of cases) {
        const state = replace(source, 0, source.length, opening);
        expect(state.doc.toString()).toBe(expected);
        expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe("Hello");
      }
    }
  });

  test("preserves a backward selection", () => {
    const state = replace('"Hello" world', 7, 0, "{");
    expect(state.doc.toString()).toBe("{Hello} world");
    expect(state.selection.main.anchor).toBe(6);
    expect(state.selection.main.head).toBe(1);
  });

  test("leaves ordinary selections to CodeMirror's existing pair wrapping", () => {
    const state = EditorState.create({
      doc: "Hello",
      selection: EditorSelection.range(0, 5),
    });
    const view = { state } as unknown as EditorView;
    expect(replaceSelectedDelimiters(view, "[")).toBe(false);
  });
});
