import { describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { matchBrackets } from "@codemirror/language";
import { typstLanguage } from "../src/editor/typstLanguage";

function backwardMatch(source: string, cursor: number) {
  const state = EditorState.create({
    doc: source,
    extensions: [typstLanguage],
  });
  return matchBrackets(state, cursor, -1);
}

describe("Typst bracket matching", () => {
  test("matches both adjacent closing brackets in nested markup content", () => {
    const source = "[#text[content]]";
    const inner = backwardMatch(source, source.length - 1);
    const outer = backwardMatch(source, source.length);

    expect(inner?.matched).toBe(true);
    expect(inner?.end).toEqual({ from: 6, to: 7 });
    expect(outer?.matched).toBe(true);
    expect(outer?.end).toEqual({ from: 0, to: 1 });
  });

  test("retains function-owned nested content matching", () => {
    const source = "#block[#text[content]]";
    const inner = backwardMatch(source, source.length - 1);
    const outer = backwardMatch(source, source.length);

    expect(inner?.matched).toBe(true);
    expect(outer?.matched).toBe(true);
  });
});
