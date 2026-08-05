import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { Tree } from "@lezer/common";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

const BRACKET_COLOR_COUNT = 5;
const VIEWPORT_BUFFER_CHARS = 2_000;
const SCROLL_SETTLE_DELAY_MS = 100;
const PARSE_SLICE_MS = 8;
const PARSE_RETRY_DELAY_MS = 50;
const MAX_PARSE_RETRIES = 20;
const refreshBracketColors = StateEffect.define<void>();

function isBracket(character: string): boolean {
  return character === "(" || character === ")" || character === "[" || character === "]" || character === "{" || character === "}";
}

function isOpeningBracket(character: string): boolean {
  return character === "(" || character === "[" || character === "{";
}

function isTypstPunctuationBracket(tree: Tree, position: number): boolean {
  return tree.resolveInner(position, 1).name === "punctuation";
}

type VisibleBracketDecorations = {
  decorations: DecorationSet;
  syntaxReady: boolean;
};

/**
 * Builds colors only around the active viewport. The depth prefix is scanned
 * once per refresh, instead of once for every bracket as the former
 * MatchDecorator implementation did.
 */
function visibleBracketDecorations(view: EditorView): VisibleBracketDecorations {
  if (view.visibleRanges.length === 0) {
    return { decorations: Decoration.none, syntaxReady: true };
  }

  const firstVisible = view.visibleRanges[0];
  const lastVisible = view.visibleRanges[view.visibleRanges.length - 1];
  const from = Math.max(0, firstVisible.from - VIEWPORT_BUFFER_CHARS);
  const to = Math.min(view.state.doc.length, lastVisible.to + VIEWPORT_BUFFER_CHARS);
  const tree = ensureSyntaxTree(view.state, to, PARSE_SLICE_MS) ?? syntaxTree(view.state);
  const syntaxReady = syntaxTreeAvailable(view.state, to);

  let depth = 0;
  const prefix = view.state.doc.sliceString(0, from);
  for (const character of prefix) {
    if (!isBracket(character)) continue;
    if (isOpeningBracket(character)) depth += 1;
    else depth = Math.max(0, depth - 1);
  }

  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.sliceString(from, to);
  for (let offset = 0; offset < text.length; offset += 1) {
    const character = text[offset];
    if (!isBracket(character)) continue;

    const position = from + offset;
    if (isTypstPunctuationBracket(tree, position)) {
      const colorDepth = isOpeningBracket(character) ? depth : Math.max(0, depth - 1);
      builder.add(
        position,
        position + 1,
        Decoration.mark({ class: `bracket-color-${colorDepth % BRACKET_COLOR_COUNT}` })
      );
    }

    if (isOpeningBracket(character)) depth += 1;
    else depth = Math.max(0, depth - 1);
  }

  return { decorations: builder.finish(), syntaxReady };
}

export const bracketColorizer = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  private refreshTimer: number | null = null;
  private parseRetries = 0;

  constructor(private readonly view: EditorView) {
    const result = visibleBracketDecorations(view);
    this.decorations = result.decorations;
    if (!result.syntaxReady) this.scheduleParserRetry();
  }

  update(update: ViewUpdate): void {
    if (update.transactions.some(transaction => transaction.effects.some(effect => effect.is(refreshBracketColors)))) {
      const result = visibleBracketDecorations(update.view);
      this.decorations = result.decorations;
      if (!result.syntaxReady) this.scheduleParserRetry();
      else this.parseRetries = 0;
      return;
    }

    if (update.docChanged) {
      this.parseRetries = 0;
      this.scheduleRefresh(16);
    } else if (update.viewportChanged) {
      this.parseRetries = 0;
      this.scheduleRefresh(SCROLL_SETTLE_DELAY_MS);
    }
  }

  destroy(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
  }

  private scheduleRefresh(delay: number): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (!this.view.dom.isConnected) return;
      this.view.dispatch({ effects: refreshBracketColors.of(undefined) });
    }, delay);
  }

  private scheduleParserRetry(): void {
    if (this.parseRetries >= MAX_PARSE_RETRIES) return;
    this.parseRetries += 1;
    this.scheduleRefresh(PARSE_RETRY_DELAY_MS);
  }
}, {
  decorations: plugin => plugin.decorations
});
