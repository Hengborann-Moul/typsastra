import { CharCategory, EditorSelection, EditorState, type Text } from "@codemirror/state";
import {
  SearchCursor,
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  selectMatches,
  setSearchQuery
} from "@codemirror/search";
import { createAppIcon, type AppIconName } from "../ui/icons";
import { runScopeHandlers, type EditorView, type Panel, type ViewUpdate } from "@codemirror/view";

const GENERIC_DIACRITICS = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/gu;

export interface TypsastraSearchQueryConfig {
  search: string;
  caseSensitive?: boolean;
  literal?: boolean;
  regexp?: boolean;
  replace?: string;
  wholeWord?: boolean;
  matchDiacritics?: boolean;
  test?: (match: string, state: EditorState, from: number, to: number) => boolean;
}

type SearchRange = { from: number; to: number; precise: boolean };
type SearchResult = SearchRange & { match?: RegExpExecArray };
type SearchRuntime = {
  spec: SearchQuery;
  nextMatch(state: EditorState, curFrom: number, curTo: number): SearchResult | null;
  prevMatch(state: EditorState, curFrom: number, curTo: number): SearchResult | null;
  getReplacement(result: SearchResult): string;
  matchAll(state: EditorState, limit: number): SearchResult[] | null;
  highlight(state: EditorState, from: number, to: number, add: (from: number, to: number) => void): void;
};

type RuntimeSearchQuery = SearchQuery & { create(): SearchRuntime };

function unquote(text: string, literal: boolean): string {
  return literal
    ? text
    : text.replace(/\\([nrt\\])/g, (_match, character: string) =>
      character === "n" ? "\n" : character === "r" ? "\r" : character === "t" ? "\t" : "\\"
    );
}

function normalizeSearchText(text: string, caseSensitive: boolean, matchDiacritics: boolean): string {
  let normalized = text;
  if (!matchDiacritics) normalized = normalized.replace(GENERIC_DIACRITICS, "");
  return caseSensitive ? normalized : normalized.toLowerCase();
}

function canonicalSearchText(text: string, caseSensitive: boolean): string {
  return normalizeSearchText(text.normalize("NFKD"), caseSensitive, true);
}

function isGenericDiacritic(character: string): boolean {
  GENERIC_DIACRITICS.lastIndex = 0;
  return GENERIC_DIACRITICS.test(character);
}

function extendOverIgnoredDiacritics(state: EditorState, to: number): number {
  let end = to;
  while (end < state.doc.length) {
    const character = String.fromCodePoint(state.doc.sliceString(end, Math.min(state.doc.length, end + 2)).codePointAt(0)!);
    if (!isGenericDiacritic(character)) break;
    end += character.length;
  }
  return end;
}

function characterBefore(state: EditorState, position: number): string {
  if (position <= 0) return "";
  const characters = Array.from(state.doc.sliceString(Math.max(0, position - 2), position));
  return characters[characters.length - 1] ?? "";
}

function characterAfter(state: EditorState, position: number): string {
  if (position >= state.doc.length) return "";
  return Array.from(state.doc.sliceString(position, Math.min(state.doc.length, position + 2)))[0] ?? "";
}

function isWholeWord(state: EditorState, from: number, to: number): boolean {
  const categorize = state.charCategorizer(state.selection.main.head);
  const before = characterBefore(state, from);
  const first = characterAfter(state, from);
  const last = characterBefore(state, to);
  const after = characterAfter(state, to);
  return (categorize(before) !== CharCategory.Word || categorize(first) !== CharCategory.Word)
    && (categorize(after) !== CharCategory.Word || categorize(last) !== CharCategory.Word);
}

function asEditorState(state: EditorState | Text): EditorState {
  return "doc" in state ? state : EditorState.create({ doc: state });
}

class DiacriticSearchCursor implements Iterator<SearchRange> {
  done = false;
  value: SearchRange = { from: 0, to: 0, precise: false };

  constructor(
    private readonly cursor: SearchCursor,
    private readonly state: EditorState,
    private readonly query: TypsastraSearchQuery
  ) {}

  next(): this {
    return this.advance(false);
  }

  nextOverlapping(): this {
    return this.advance(true);
  }

  private advance(overlapping: boolean): this {
    for (;;) {
      const result = overlapping ? this.cursor.nextOverlapping() : this.cursor.next();
      if (result.done) {
        this.done = true;
        return this;
      }
      const from = result.value.from;
      const to = this.query.matchDiacritics
        ? result.value.to
        : extendOverIgnoredDiacritics(this.state, result.value.to);
      const matchedText = this.state.sliceDoc(from, to);
      if (
        this.query.matchDiacritics
        && canonicalSearchText(matchedText, this.query.caseSensitive)
          !== canonicalSearchText(this.query.unquotedSearch, this.query.caseSensitive)
      ) continue;
      if (this.query.wholeWord && !isWholeWord(this.state, from, to)) continue;
      if (this.query.test && !this.query.test(matchedText, this.state, from, to)) continue;
      this.done = false;
      this.value = { from, to, precise: true };
      return this;
    }
  }

  [Symbol.iterator](): Iterator<SearchRange> {
    return this;
  }
}

class LiteralSearchRuntime implements SearchRuntime {
  readonly spec: TypsastraSearchQuery;

  constructor(query: TypsastraSearchQuery) {
    this.spec = query;
  }

  nextMatch(state: EditorState, curFrom: number, curTo: number): SearchRange | null {
    let cursor = this.spec.cursor(state, curTo, state.doc.length);
    let result = cursor.nextOverlapping();
    if (result.done) {
      const end = Math.min(state.doc.length, curFrom + this.spec.unquotedSearch.length + 2);
      cursor = this.spec.cursor(state, 0, end);
      result = cursor.nextOverlapping();
    }
    return result.done || (result.value.from === curFrom && result.value.to === curTo)
      ? null
      : result.value;
  }

  private previousInRange(state: EditorState, from: number, to: number): SearchRange | null {
    for (let position = to;;) {
      const start = Math.max(from, position - 10_000 - this.spec.unquotedSearch.length);
      const cursor = this.spec.cursor(state, start, position);
      let range: SearchRange | null = null;
      while (!cursor.nextOverlapping().done) range = cursor.value;
      if (range) return range;
      if (start === from) return null;
      position -= 10_000;
    }
  }

  prevMatch(state: EditorState, curFrom: number, curTo: number): SearchRange | null {
    const found = this.previousInRange(state, 0, curFrom)
      ?? this.previousInRange(
        state,
        Math.max(0, curTo - this.spec.unquotedSearch.length - 2),
        state.doc.length
      );
    return found && (found.from !== curFrom || found.to !== curTo) ? found : null;
  }

  getReplacement(): string {
    return unquote(this.spec.replace, this.spec.literal);
  }

  matchAll(state: EditorState, limit: number): SearchRange[] | null {
    const cursor = this.spec.cursor(state, 0, state.doc.length);
    const ranges: SearchRange[] = [];
    while (!cursor.next().done) {
      if (ranges.length >= limit) return null;
      ranges.push(cursor.value);
    }
    return ranges;
  }

  highlight(
    state: EditorState,
    from: number,
    to: number,
    add: (from: number, to: number) => void
  ): void {
    const margin = this.spec.unquotedSearch.length + 2;
    const cursor = this.spec.cursor(
      state,
      Math.max(0, from - margin),
      Math.min(state.doc.length, to + margin)
    );
    while (!cursor.next().done) add(cursor.value.from, cursor.value.to);
  }
}

export class TypsastraSearchQuery extends SearchQuery {
  readonly matchDiacritics: boolean;
  readonly unquotedSearch: string;

  constructor(config: TypsastraSearchQueryConfig) {
    super(config);
    this.matchDiacritics = config.matchDiacritics !== false;
    this.unquotedSearch = unquote(config.search, !!config.literal);
  }

  override eq(other: SearchQuery): boolean {
    return super.eq(other)
      && this.matchDiacritics === (
        other instanceof TypsastraSearchQuery ? other.matchDiacritics : true
      );
  }

  override getCursor(state: EditorState | Text, from = 0, to?: number): Iterator<SearchRange> {
    if (this.regexp) return super.getCursor(state, from, to) as Iterator<SearchRange>;
    const editorState = asEditorState(state);
    return this.cursor(editorState, from, to ?? editorState.doc.length);
  }

  cursor(state: EditorState, from: number, to: number): DiacriticSearchCursor {
    const normalize = (text: string) => normalizeSearchText(
      text,
      this.caseSensitive,
      this.matchDiacritics
    );
    return new DiacriticSearchCursor(
      new SearchCursor(state.doc, this.unquotedSearch, from, to, normalize),
      state,
      this
    );
  }

  create(): SearchRuntime {
    if (!this.regexp) return new LiteralSearchRuntime(this);
    const base = new SearchQuery({
      search: this.search,
      caseSensitive: this.caseSensitive,
      literal: this.literal,
      regexp: true,
      replace: this.replace,
      wholeWord: this.wholeWord,
      test: this.test
    }) as RuntimeSearchQuery;
    return base.create();
  }
}

function input(attributes: Record<string, string | boolean | EventListener>): HTMLInputElement {
  const element = document.createElement("input");
  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value === "boolean") {
      if (name === "checked") element.checked = value;
      else if (name === "disabled") element.disabled = value;
      else if (name === "spellcheck") element.spellcheck = value;
    } else if (typeof value === "function" && name.startsWith("on")) {
      element.addEventListener(name.slice(2), value);
    } else {
      element.setAttribute(name, String(value));
    }
  }
  return element;
}

function editorCaretInput(field: HTMLInputElement): HTMLSpanElement {
  const shell = document.createElement("span");
  shell.className = "cm-search-textfield-shell";
  const measure = document.createElement("span");
  measure.className = "cm-search-caret-measure";
  const caret = document.createElement("span");
  caret.className = "cm-search-editor-caret";
  shell.append(field, measure, caret);

  const updateCaret = () => {
    const selection = field.selectionStart ?? 0;
    const selectionEnd = field.selectionEnd ?? selection;
    caret.style.visibility = selection === selectionEnd ? "visible" : "hidden";
    measure.textContent = field.value.slice(0, selection) || "\u200b";
    const measuredWidth = selection === 0 ? 0 : measure.getBoundingClientRect().width;
    caret.style.left = `${6 + measuredWidth - field.scrollLeft}px`;
  };
  for (const event of ["focus", "input", "click", "keyup", "select", "scroll"]) {
    field.addEventListener(event, updateCaret);
  }
  field.addEventListener("focus", () => requestAnimationFrame(updateCaret));
  updateCaret();
  return shell;
}

function iconButton(name: string, label: string, icon: AppIconName, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.name = name;
  element.className = "cm-button cm-search-icon-button";
  element.title = label;
  element.setAttribute("aria-label", label);
  element.append(createAppIcon(icon, { size: 16 }));
  element.addEventListener("click", action);
  return element;
}

function iconToggle(field: HTMLInputElement, label: string, icon: AppIconName): HTMLLabelElement {
  const element = document.createElement("label");
  element.className = "cm-search-icon-toggle";
  element.title = label;
  field.setAttribute("aria-label", label);
  element.append(field, createAppIcon(icon, { size: 16 }));
  return element;
}

function queryMatchDiacritics(query: SearchQuery): boolean {
  return query instanceof TypsastraSearchQuery ? query.matchDiacritics : true;
}

export function collapseSearchSelection(state: EditorState): EditorSelection {
  const selection = state.selection;
  return EditorSelection.create(
    selection.ranges.map(range => EditorSelection.cursor(range.head)),
    selection.mainIndex
  );
}

export class TypsastraSearchPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  readonly pos = 80;
  private query: TypsastraSearchQuery;
  private readonly searchField: HTMLInputElement;
  private readonly replaceField: HTMLInputElement;
  private readonly caseField: HTMLInputElement;
  private readonly regexpField: HTMLInputElement;
  private readonly wordField: HTMLInputElement;
  private readonly diacriticsField: HTMLInputElement;

  constructor(private readonly view: EditorView) {
    const initial = getSearchQuery(view.state);
    this.query = this.fromQuery(initial);
    const commit = () => this.commit();
    this.searchField = input({
      value: this.query.search,
      placeholder: "Find",
      "aria-label": "Find",
      class: "cm-textfield",
      name: "search",
      form: "",
      "main-field": "true",
      autocomplete: "off",
      spellcheck: false,
      oninput: commit,
      onchange: commit
    });
    this.replaceField = input({
      value: this.query.replace,
      placeholder: "Replace",
      "aria-label": "Replace",
      class: "cm-textfield",
      name: "replace",
      form: "",
      autocomplete: "off",
      spellcheck: false,
      oninput: commit,
      onchange: commit
    });
    this.caseField = input({ type: "checkbox", name: "case", form: "", checked: this.query.caseSensitive, onchange: commit });
    this.regexpField = input({ type: "checkbox", name: "re", form: "", checked: this.query.regexp, onchange: commit });
    this.wordField = input({ type: "checkbox", name: "word", form: "", checked: this.query.wholeWord, onchange: commit });
    this.diacriticsField = input({
      type: "checkbox",
      name: "diacritics",
      form: "",
      checked: this.query.matchDiacritics,
      disabled: this.query.regexp,
      onchange: commit
    });
    this.dom = document.createElement("div");
    this.dom.className = "cm-search";
    this.dom.addEventListener("keydown", event => this.keydown(event));
    const searchRow = document.createElement("div");
    searchRow.className = "cm-search-row";
    searchRow.append(
      editorCaretInput(this.searchField),
      iconButton("next", "Next match", "arrowDown", () => findNext(view)),
      iconButton("prev", "Previous match", "arrowUp", () => findPrevious(view)),
      iconButton("select", "Select all matches", "listChecks", () => selectMatches(view)),
      iconToggle(this.caseField, "Match case", "caseSensitive"),
      iconToggle(this.regexpField, "Use regular expression", "regex"),
      iconToggle(this.wordField, "Match whole word", "wholeWord"),
      iconToggle(this.diacriticsField, "Match diacritics", "languages")
    );
    
    const replaceRow = document.createElement("div");
    replaceRow.className = "cm-search-row";
    
    if (!view.state.readOnly) {
      replaceRow.append(
        editorCaretInput(this.replaceField),
        iconButton("replace", "Replace next match", "replace", () => replaceNext(view)),
        iconButton("replaceAll", "Replace all matches", "replaceAll", () => replaceAll(view))
      );
    }

    Object.assign(searchRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "4px"
    });
    
    Object.assign(replaceRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "4px"
    });
    
    this.searchField.style.width = "280px";
    this.replaceField.style.width = "280px";
    
    this.dom.append(searchRow);
    if (!view.state.readOnly) this.dom.append(replaceRow);
    
    const close = iconButton("close", "Close search", "x", () => closeSearchPanel(view));
    this.dom.append(close);
  }

  mount(): void {
    this.searchField.select();
    // CodeMirror mounts panels while applying the transaction that opened
    // them. Dispatching synchronously from here aborts that view update and
    // prevents the search panel from appearing. Promote the initial native
    // query to Typsastra's query type after the opening transaction settles.
    queueMicrotask(() => {
      if (!this.dom.isConnected) return;
      const current = getSearchQuery(this.view.state);
      if (current instanceof TypsastraSearchQuery && current.eq(this.query)) return;
      this.view.dispatch({ effects: setSearchQuery.of(this.query) });
    });
  }

  update(update: ViewUpdate): void {
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.setQuery(effect.value);
        }
      }
    }
  }

  private fromQuery(query: SearchQuery): TypsastraSearchQuery {
    return new TypsastraSearchQuery({
      search: query.search,
      caseSensitive: query.caseSensitive,
      literal: query.literal,
      regexp: query.regexp,
      replace: query.replace,
      wholeWord: query.wholeWord,
      matchDiacritics: queryMatchDiacritics(query),
      test: query.test
    });
  }

  private commit(): void {
    const query = new TypsastraSearchQuery({
      search: this.searchField.value,
      caseSensitive: this.caseField.checked,
      regexp: this.regexpField.checked,
      wholeWord: this.wordField.checked,
      replace: this.replaceField.value,
      matchDiacritics: this.diacriticsField.checked
    });
    this.diacriticsField.disabled = query.regexp;
    if (!query.eq(this.query)) {
      const clearSearchSelection = !query.valid
        && this.query.valid
        && !this.view.state.selection.main.empty;
      this.query = query;
      this.view.dispatch({
        effects: setSearchQuery.of(query),
        ...(clearSearchSelection ? { selection: collapseSearchSelection(this.view.state) } : {})
      });
    }
  }

  private setQuery(query: SearchQuery): void {
    this.query = this.fromQuery(query);
    this.searchField.value = this.query.search;
    this.replaceField.value = this.query.replace;
    this.caseField.checked = this.query.caseSensitive;
    this.regexpField.checked = this.query.regexp;
    this.wordField.checked = this.query.wholeWord;
    this.diacriticsField.checked = this.query.matchDiacritics;
    this.diacriticsField.disabled = this.query.regexp;
  }

  private keydown(event: KeyboardEvent): void {
    if (runScopeHandlers(this.view, event, "search-panel")) {
      event.preventDefault();
    } else if (event.key === "Enter" && event.target === this.searchField) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(this.view);
    } else if (event.key === "Enter" && event.target === this.replaceField) {
      event.preventDefault();
      replaceNext(this.view);
    }
  }
}
