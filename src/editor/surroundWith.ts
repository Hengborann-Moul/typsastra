import type { EditorView } from "@codemirror/view";

export type SurroundWithOption = {
  id: string;
  label: string;
  description: string;
  prefix: string;
  suffix: string;
  searchTerms: readonly string[];
};

/**
 * Curated Typst forms whose final content argument supports bracket syntax.
 * Keep this list deliberately conservative: ordinary functions must not leak
 * into Surround With merely because they appear in completion results.
 */
export const SURROUND_WITH_OPTIONS: readonly SurroundWithOption[] = [
  { id: "content", label: "#[…]", description: "Content block", prefix: "#[", suffix: "]", searchTerms: ["content", "block"] },
  { id: "emph", label: "#emph[…]", description: "Emphasis", prefix: "#emph[", suffix: "]", searchTerms: ["emphasis", "italic"] },
  { id: "strong", label: "#strong[…]", description: "Strong emphasis", prefix: "#strong[", suffix: "]", searchTerms: ["bold", "strong"] },
  { id: "block", label: "#block[…]", description: "Block container", prefix: "#block[", suffix: "]", searchTerms: ["container", "layout"] },
  { id: "box", label: "#box[…]", description: "Inline box", prefix: "#box[", suffix: "]", searchTerms: ["inline", "container"] },
  { id: "highlight", label: "#highlight[…]", description: "Highlighted content", prefix: "#highlight[", suffix: "]", searchTerms: ["mark", "background"] },
  { id: "underline", label: "#underline[…]", description: "Underlined content", prefix: "#underline[", suffix: "]", searchTerms: ["line", "decoration"] },
  { id: "overline", label: "#overline[…]", description: "Overlined content", prefix: "#overline[", suffix: "]", searchTerms: ["line", "decoration"] },
  { id: "strike", label: "#strike[…]", description: "Struck-through content", prefix: "#strike[", suffix: "]", searchTerms: ["strikethrough", "delete"] },
  { id: "smallcaps", label: "#smallcaps[…]", description: "Small capitals", prefix: "#smallcaps[", suffix: "]", searchTerms: ["small caps", "capital"] },
  { id: "sub", label: "#sub[…]", description: "Subscript", prefix: "#sub[", suffix: "]", searchTerms: ["subscript"] },
  { id: "super", label: "#super[…]", description: "Superscript", prefix: "#super[", suffix: "]", searchTerms: ["superscript"] },
  { id: "heading", label: "#heading[…]", description: "Heading", prefix: "#heading[", suffix: "]", searchTerms: ["title", "section"] },
  { id: "quote", label: "#quote[…]", description: "Quotation", prefix: "#quote[", suffix: "]", searchTerms: ["quotation", "citation"] },
  { id: "align", label: "#align[…]", description: "Aligned content", prefix: "#align[", suffix: "]", searchTerms: ["alignment", "layout"] },
  { id: "figure", label: "#figure[…]", description: "Figure body", prefix: "#figure[", suffix: "]", searchTerms: ["caption", "float"] },
  { id: "text", label: "#text[…]", description: "Styled text", prefix: "#text[", suffix: "]", searchTerms: ["font", "style"] },
  { id: "hide", label: "#hide[…]", description: "Hidden content", prefix: "#hide[", suffix: "]", searchTerms: ["invisible"] },
];

function normalizedSearch(value: string): string {
  return value.toLocaleLowerCase().replace(/^#/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function fuzzyMatch(value: string, query: string): boolean {
  if (!query) return true;
  if (value.includes(query)) return true;
  let queryIndex = 0;
  for (const character of value) {
    if (character === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return false;
}

export function filterSurroundWithOptions(
  query: string,
  options: readonly SurroundWithOption[] = SURROUND_WITH_OPTIONS,
): SurroundWithOption[] {
  const normalizedQuery = normalizedSearch(query);
  if (!normalizedQuery) return [...options];
  const tokens = normalizedQuery.split(/\s+/u);
  return options.filter(option => {
    const searchable = normalizedSearch([
      option.id,
      option.label,
      option.description,
      ...option.searchTerms,
    ].join(" "));
    return tokens.every(token => fuzzyMatch(searchable, token));
  });
}

export function surroundEditorRange(
  editor: EditorView,
  from: number,
  to: number,
  option: SurroundWithOption,
): boolean {
  if (from < 0 || to <= from || to > editor.state.doc.length) return false;
  const selected = editor.state.sliceDoc(from, to);
  const inserted = `${option.prefix}${selected}${option.suffix}`;
  const innerFrom = from + option.prefix.length;
  editor.dispatch({
    changes: { from, to, insert: inserted },
    selection: { anchor: innerFrom, head: innerFrom + selected.length },
    scrollIntoView: true,
    userEvent: "input.surround",
  });
  editor.focus();
  return true;
}
