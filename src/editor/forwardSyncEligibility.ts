import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

const FORWARD_SYNC_CONTENT_NODES = new Set(["content", "heading", "term"]);

function isContentPosition(state: EditorState, position: number, bias: -1 | 1): boolean {
  const names = syntaxTree(state).resolveInner(position, bias).name.split(/[ _]+/u);
  return names.some(name => FORWARD_SYNC_CONTENT_NODES.has(name));
}

/**
 * Tinymist's PDF source map resolves textual Typst content. A source expression
 * may render something (for example #image) without producing a text position,
 * so rendered output alone is not enough to make forward sync eligible.
 */
export function isForwardSyncContentPosition(state: EditorState, position: number): boolean {
  if (position < 0 || position > state.doc.length) return false;
  return isContentPosition(state, position, -1) || isContentPosition(state, position, 1);
}
