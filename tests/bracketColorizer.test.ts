import { describe, expect, test } from "bun:test";
import { EditorState, Text } from "@codemirror/state";
import { BracketDepthIndex } from "../src/editor/bracketColorizer";

describe("viewport bracket depth index", () => {
  test("recovers deep prefix depth without rescanning preceding text", () => {
    const doc = Text.of([
      "#block([",
      "  first",
      "  #figure([content])",
      "  last",
      "])",
    ]);
    const index = new BracketDepthIndex(doc);

    expect(index.depthAt(doc, doc.line(2).from)).toBe(2);
    expect(index.depthAt(doc, doc.line(3).from)).toBe(2);
    expect(index.depthAt(doc, doc.length)).toBe(0);
  });

  test("clamps unmatched closing brackets like the viewport colorizer", () => {
    const doc = Text.of(["}}", "#block([", "content", "])"]);
    const index = new BracketDepthIndex(doc);

    expect(index.depthAt(doc, doc.line(2).from)).toBe(0);
    expect(index.depthAt(doc, doc.line(3).from)).toBe(2);
    expect(index.depthAt(doc, doc.length)).toBe(0);
  });

  test("updates only affected line summaries for ordinary edits", () => {
    const start = EditorState.create({ doc: "#block([\ncontent\n])" });
    const transaction = start.update({ changes: { from: 8, to: 8, insert: "(" } });
    const index = new BracketDepthIndex(start.doc);
    index.update({
      startState: start,
      state: transaction.state,
      docChanged: true,
      changes: transaction.changes,
    } as never);

    expect(index.depthAt(transaction.state.doc, transaction.state.doc.line(2).from)).toBe(3);
  });
});
