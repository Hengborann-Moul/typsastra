import { describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { isForwardSyncContentPosition } from "../src/editor/forwardSyncEligibility";
import { typstLanguage } from "../src/editor/typstLanguage";

function stateFor(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [typstLanguage] });
}

describe("forward sync eligibility", () => {
  test("accepts textual markup and content blocks", () => {
    const doc = "Visible paragraph\n= Heading\n#text[More content]";
    const state = stateFor(doc);

    expect(isForwardSyncContentPosition(state, doc.indexOf("Visible") + 2)).toBe(true);
    expect(isForwardSyncContentPosition(state, doc.indexOf("Heading") + 2)).toBe(true);
    expect(isForwardSyncContentPosition(state, doc.indexOf("More") + 2)).toBe(true);
  });

  test("rejects image calls and other code-only positions", () => {
    const doc = '#image("images/photo.png")\n#set text(size: 11pt)\n// hidden note';
    const state = stateFor(doc);

    expect(isForwardSyncContentPosition(state, doc.indexOf("image") + 2)).toBe(false);
    expect(isForwardSyncContentPosition(state, doc.indexOf("photo") + 2)).toBe(false);
    expect(isForwardSyncContentPosition(state, doc.indexOf("size") + 2)).toBe(false);
    expect(isForwardSyncContentPosition(state, doc.indexOf("hidden") + 2)).toBe(false);
  });
});
