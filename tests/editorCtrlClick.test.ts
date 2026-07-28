import { describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { typstCtrlClickTextRange } from "../src/editor/extensions";

function selectedText(doc: string, needle: string): string | null {
  const state = EditorState.create({ doc });
  const position = doc.indexOf(needle) + Math.floor(needle.length / 2);
  const range = typstCtrlClickTextRange(state, position);
  return range ? state.doc.sliceString(range.from, range.to) : null;
}

describe("editor Ctrl-click highlighting", () => {
  test("highlights a complete dashed reference", () => {
    expect(selectedText("See @project-timeline.", "timeline")).toBe("project-timeline");
    expect(selectedText("See @project-timeline.", "project")).toBe("project-timeline");
  });

  test("highlights a complete label containing dashes and colons", () => {
    expect(selectedText("<chapter-one:intro>", "one")).toBe("chapter-one:intro");
  });

  test("keeps dashed Typst identifiers together", () => {
    expect(selectedText("#project-timeline", "timeline")).toBe("project-timeline");
  });

  test("keeps linked file paths together", () => {
    expect(selectedText('#include "chapters/project-timeline.typ"', "timeline")).toBe(
      "chapters/project-timeline.typ"
    );
  });
});
