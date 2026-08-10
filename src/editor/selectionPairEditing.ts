import { EditorSelection } from "@codemirror/state";
import { EditorView, type Command } from "@codemirror/view";

export const EDITOR_DELIMITER_PAIRS = {
  '"': '"',
  "(": ")",
  "[": "]",
  "{": "}",
} as const;

export type EditorOpeningDelimiter = keyof typeof EDITOR_DELIMITER_PAIRS;

export function pairedSelectionContent(selected: string): string | null {
  if (selected.length < 2) return null;
  const opening = selected[0] as EditorOpeningDelimiter;
  const closing = EDITOR_DELIMITER_PAIRS[opening];
  return closing !== undefined && selected.endsWith(closing)
    ? selected.slice(1, -1)
    : null;
}

/**
 * Replaces the outer delimiters of every selection with the requested pair.
 * Ordinary selections deliberately fall through to CodeMirror's existing
 * pair-wrapping behavior.
 */
export function replaceSelectedDelimiters(
  view: EditorView,
  opening: EditorOpeningDelimiter,
): boolean {
  if (view.state.readOnly || view.state.selection.ranges.some(range => range.empty)) return false;
  const replacements = view.state.selection.ranges.map(range =>
    pairedSelectionContent(view.state.doc.sliceString(range.from, range.to))
  );
  if (replacements.some(content => content === null)) return false;
  const closing = EDITOR_DELIMITER_PAIRS[opening];
  let index = 0;
  const transaction = view.state.changeByRange(range => {
    const content = replacements[index++]!;
    const innerFrom = range.from + 1;
    const innerTo = innerFrom + content.length;
    return {
      changes: { from: range.from, to: range.to, insert: `${opening}${content}${closing}` },
      range: range.anchor > range.head
        ? EditorSelection.range(innerTo, innerFrom)
        : EditorSelection.range(innerFrom, innerTo),
    };
  });
  view.dispatch(view.state.update(transaction, {
    scrollIntoView: true,
    userEvent: "input.type",
  }));
  return true;
}

export const replaceSelectedPair: Command = view => replaceSelectedDelimiters(view, "[");

export const selectionPairReplacementExtension = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (view.composing || !(text in EDITOR_DELIMITER_PAIRS)) return false;
  return replaceSelectedDelimiters(view, text as EditorOpeningDelimiter);
});
