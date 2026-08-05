import { describe, expect, test } from "bun:test";
import {
  filterSurroundWithOptions,
  SURROUND_WITH_OPTIONS,
  surroundEditorRange,
} from "../src/editor/surroundWith";
import type { EditorView } from "@codemirror/view";

describe("Surround With options", () => {
  test("contains only explicit bracket wrappers", () => {
    expect(SURROUND_WITH_OPTIONS.length).toBeGreaterThan(4);
    for (const option of SURROUND_WITH_OPTIONS) {
      expect(option.prefix.endsWith("[")).toBe(true);
      expect(option.suffix).toBe("]");
      expect(option.label.endsWith("[…]")).toBe(true);
    }
  });

  test("finds functions by name and purpose", () => {
    expect(filterSurroundWithOptions("emph").map(option => option.id)).toContain("emph");
    expect(filterSurroundWithOptions("caption").map(option => option.id)).toEqual(["figure"]);
    expect(filterSurroundWithOptions("strk").map(option => option.id)).toContain("strike");
  });

  test("does not include ordinary non-content functions", () => {
    const ids = SURROUND_WITH_OPTIONS.map(option => option.id);
    expect(ids).not.toContain("image");
    expect(ids).not.toContain("rgb");
    expect(ids).not.toContain("pagebreak");
  });

  test("wraps the selected source and preserves the inner selection", () => {
    const transactions: unknown[] = [];
    let focused = false;
    const source = "Before important text after";
    const editor = {
      state: {
        doc: { length: source.length },
        sliceDoc: (from: number, to: number) => source.slice(from, to),
      },
      dispatch: (transaction: unknown) => transactions.push(transaction),
      focus: () => { focused = true; },
    } as unknown as EditorView;
    const option = SURROUND_WITH_OPTIONS.find(candidate => candidate.id === "emph")!;

    expect(surroundEditorRange(editor, 7, 21, option)).toBe(true);
    expect(transactions).toEqual([{
      changes: { from: 7, to: 21, insert: "#emph[important text]" },
      selection: { anchor: 13, head: 27 },
      scrollIntoView: true,
      userEvent: "input.surround",
    }]);
    expect(focused).toBe(true);
  });
});
