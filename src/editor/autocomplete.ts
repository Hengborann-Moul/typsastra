import {
  autocompletion,
  CompletionContext,
  snippetCompletion,
  Completion,
  startCompletion
} from "@codemirror/autocomplete";
import type { Text } from "@codemirror/state";
import type { TinymistLspClient } from "../compiler/lsp";
import type { LanguageProviderCapabilities } from "../languageSupport";
import { invoke } from "@tauri-apps/api/core";
import type { CompletionProviderSelection } from "./languageScopes";

type LspPosition = { line: number; character?: number };
type LspRange = { start: LspPosition; end: LspPosition };
type LspTextEdit = {
  newText?: string;
  range?: LspRange;
  insert?: LspRange;
  replace?: LspRange;
};
type LspEditRange = LspRange | { insert: LspRange; replace: LspRange };

type LspCompletionItem = {
  label: string;
  labelDetails?: { description?: string; detail?: string };
  detail?: string;
  documentation?: string | { value?: string };
  kind?: number;
  insertText?: string;
  textEdit?: LspTextEdit;
  insertTextFormat?: number;
  sortText?: string;
  additionalTextEdits?: LspTextEdit[];
};

type LspCompletionResponse = LspCompletionItem[] | {
  items?: LspCompletionItem[];
  itemDefaults?: {
    editRange?: LspEditRange;
    insertTextFormat?: number;
  };
} | null;

export type TypstCompletionSyntaxVariant = "bare" | "paren" | "bracket";

export type TypstCompletionPreferenceScores = Record<
  string,
  Partial<Record<TypstCompletionSyntaxVariant, number>>
>;

type CompletionPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const completionPreferenceStorageKey = "typsastra-completion-preferences-v1";
const completionPreferenceDecay = 0.8;

export function typstCompletionSyntax(label: string): {
  family: string;
  variant: TypstCompletionSyntaxVariant;
  displayLabel: string;
} {
  const match = /^(#?[\p{L}\p{M}\p{N}_-]+)(?:\.(paren|bracket)|(\(\)|\[\]))$/u.exec(label);
  if (!match) {
    return {
      family: label.replace(/^#/, ""),
      variant: "bare",
      displayLabel: label
    };
  }
  const variant: Exclude<TypstCompletionSyntaxVariant, "bare"> =
    match[2] === "paren" || match[3] === "()" ? "paren" : "bracket";
  return {
    family: match[1].replace(/^#/, ""),
    variant,
    displayLabel: `${match[1]}${variant === "paren" ? "()" : "[]"}`
  };
}

type CompletionSyntaxItem = {
  label: string;
  kind?: number;
  detail?: string;
  labelDetails?: { description?: string };
};

function isCallableCompletionItem(item: CompletionSyntaxItem): boolean {
  return item.kind === 2
    || item.kind === 3
    || item.kind === 4
    || /^\s*\([^)]*\)\s*=>/s.test(item.detail ?? item.labelDetails?.description ?? "");
}

export function effectiveTypstCompletionSyntax(
  item: CompletionSyntaxItem,
  _rawVariantsByFamily: ReadonlyMap<string, ReadonlySet<TypstCompletionSyntaxVariant>>
): ReturnType<typeof typstCompletionSyntax> {
  const syntax = typstCompletionSyntax(item.label);
  if (syntax.variant === "paren") {
    return {
      family: syntax.family,
      variant: "bare",
      displayLabel: `${item.label.startsWith("#") ? "#" : ""}${syntax.family}`
    };
  }
  if (syntax.variant !== "bare" || !isCallableCompletionItem(item)) return syntax;
  return {
    family: syntax.family,
    variant: "bare",
    displayLabel: item.label
  };
}

export function deduplicateTypstCompletionVariants<T extends CompletionSyntaxItem>(
  items: readonly T[]
): T[] {
  const rawVariantsByFamily = typstCompletionVariantsByFamily(
    items.map(item => item.label)
  );
  const result: T[] = [];
  const indexes = new Map<string, number>();
  for (const item of items) {
    const syntax = effectiveTypstCompletionSyntax(item, rawVariantsByFamily);
    const key = `${syntax.family}:${syntax.variant}`;
    const existingIndex = indexes.get(key);
    if (existingIndex === undefined) {
      indexes.set(key, result.length);
      result.push(item);
      continue;
    }
    // Tinymist's semantic `.paren` and `.bracket` entries carry the
    // authoritative snippets. Prefer them over an equivalent visible-label
    // alias such as `figure()` when both are returned.
    const primaryCallable = typstCompletionSyntax(item.label).variant === "bare"
      && isCallableCompletionItem(item);
    const existingPrimaryCallable = typstCompletionSyntax(result[existingIndex].label).variant === "bare"
      && isCallableCompletionItem(result[existingIndex]);
    const explicitVariant = /\.(?:paren|bracket)$/u.test(item.label);
    const existingExplicitVariant = /\.(?:paren|bracket)$/u.test(
      result[existingIndex].label
    );
    if ((primaryCallable && !existingPrimaryCallable)
      || (!existingPrimaryCallable && explicitVariant && !existingExplicitVariant)) {
      result[existingIndex] = item;
    }
  }
  return result;
}

function completionPreferenceStorage(): CompletionPreferenceStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readTypstCompletionPreferences(
  storage: CompletionPreferenceStorage | null = completionPreferenceStorage()
): TypstCompletionPreferenceScores {
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(completionPreferenceStorageKey) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: TypstCompletionPreferenceScores = {};
    for (const [family, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const scores: Partial<Record<TypstCompletionSyntaxVariant, number>> = {};
      for (const variant of ["bare", "paren", "bracket"] as const) {
        const score = (value as Record<string, unknown>)[variant];
        if (typeof score === "number" && Number.isFinite(score) && score > 0) {
          scores[variant] = score;
        }
      }
      if (Object.keys(scores).length > 0) result[family] = scores;
    }
    return result;
  } catch {
    return {};
  }
}

export function recordTypstCompletionPreference(
  label: string,
  storage: CompletionPreferenceStorage | null = completionPreferenceStorage()
): void {
  if (!storage) return;
  const { family, variant } = typstCompletionSyntax(label);
  const preferences = readTypstCompletionPreferences(storage);
  for (const [candidateFamily, previous] of Object.entries(preferences)) {
    const next: Partial<Record<TypstCompletionSyntaxVariant, number>> = {};
    for (const candidate of ["bare", "paren", "bracket"] as const) {
      const decayed = (previous[candidate] ?? 0) * completionPreferenceDecay;
      if (decayed >= 0.001) next[candidate] = Number(decayed.toFixed(4));
    }
    if (Object.keys(next).length > 0) preferences[candidateFamily] = next;
    else delete preferences[candidateFamily];
  }
  const selected = preferences[family] ?? {};
  selected[variant] = Number(((selected[variant] ?? 0) + 1).toFixed(4));
  preferences[family] = selected;
  try {
    storage.setItem(completionPreferenceStorageKey, JSON.stringify(preferences));
  } catch {
    // Completion remains functional when WebView storage is unavailable.
  }
}

export function typstCompletionPreferenceBoost(
  label: string,
  variantsByFamily: ReadonlyMap<string, ReadonlySet<TypstCompletionSyntaxVariant>>,
  preferences: TypstCompletionPreferenceScores
): number | undefined {
  const { family, variant } = typstCompletionSyntax(label);
  const variants = variantsByFamily.get(family);
  if (!variants) return undefined;
  const scores = preferences[family];
  const score = scores?.[variant] ?? 0;
  if (score <= 0) return undefined;
  const maximum = Math.max(
    0,
    ...[...variantsByFamily].flatMap(([candidateFamily, candidates]) =>
      [...candidates].map(candidate => preferences[candidateFamily]?.[candidate] ?? 0)
    )
  );
  return maximum > 0 ? Math.max(1, Math.min(99, Math.round((score / maximum) * 99))) : undefined;
}

export function typstCompletionVariantsByFamily(
  labels: readonly string[]
): Map<string, Set<TypstCompletionSyntaxVariant>> {
  const result = new Map<string, Set<TypstCompletionSyntaxVariant>>();
  for (const label of labels) {
    const { family, variant } = typstCompletionSyntax(label);
    const variants = result.get(family) ?? new Set<TypstCompletionSyntaxVariant>();
    variants.add(variant);
    result.set(family, variants);
  }
  return result;
}

export type LanguageCompletionResponse = {
  provider: string;
  from: number;
  to: number;
  options: string[];
};

export function languageCompletionRange(
  runFrom: number,
  runLength: number,
  completion: LanguageCompletionResponse | null
): { from: number; to: number } | null {
  if (!completion || completion.from < 0 || completion.from >= completion.to
    || completion.to !== runLength) return null;
  return { from: runFrom + completion.from, to: runFrom + completion.to };
}

export const languageCompletionValidFor = () => false;

// Keep a Tinymist or fallback Typst completion result alive while the user
// extends the same identifier. Without this, the asynchronous list opened by
// `#` is discarded on the very next character instead of being filtered.
// A dot changes the semantic completion context from a global Typst token to
// member access. Do not let the pre-dot result survive that transition, or
// CodeMirror will keep filtering the old global list (for example `#int`) for
// `#it.` instead of asking Tinymist for `it`'s fields.
export const typstCompletionValidFor = /^#?[\p{L}\p{M}\p{N}_-]*$/u;
export const typstMemberCompletionValidFor = /^[\p{L}\p{M}\p{N}_-]*$/u;
export const typstArgumentCompletionValidFor = /^\s*[\p{L}\p{M}\p{N}_-]*$/u;

function completionInsertion(item: LspCompletionItem): string {
  return item.textEdit?.newText ?? item.insertText ?? item.label;
}

export function isNamedArgumentCompletion(item: LspCompletionItem): boolean {
  // Tinymist has reported function parameters as both fields and properties
  // across versions. Require both that semantic kind and inserted `name:`
  // syntax: global snippets such as `show: ...` also contain a colon, but are
  // not arguments of the function surrounding the caret.
  return (item.kind === 5 || item.kind === 10)
    && /^\s*[\p{L}_][\p{L}\p{N}_-]*\s*:/u.test(completionInsertion(item));
}

export function isDirectMemberCompletion(item: LspCompletionItem): boolean {
  // Tinymist also returns expression transformations in member completion,
  // such as wrapping a content value with `text`, `block`, or `align`. Those
  // are useful code actions, but they are not members of the receiver. Real
  // methods, element fields, dictionary keys, and module definitions edit
  // only the identifier after the dot.
  return item.kind !== 15
    && (!item.additionalTextEdits || item.additionalTextEdits.length === 0);
}

export function isEmptyTypstFunctionCallAt(
  lineText: string,
  cursor: number
): boolean {
  const boundedCursor = Math.max(0, Math.min(cursor, lineText.length));
  const before = lineText.slice(0, boundedCursor);
  const after = lineText.slice(boundedCursor);
  return /#(?:(?:set|show)\s+)?[\p{L}\p{M}\p{N}_.-]+\($/u.test(before)
    && after.startsWith(")");
}

function innermostTypstFunctionArgumentStart(
  doc: Text,
  cursorPosition: number
): number | null {
  const text = doc.sliceString(0, Math.max(0, Math.min(cursorPosition, doc.length)));
  const stack: Array<{ delimiter: string; index: number }> = [];
  let inString = false;
  let inLineComment = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }
    if (inString) {
      if (char === '"' && !isEscaped(text, index)) inString = false;
      continue;
    }
    if (char === "/" && next === "/") {
      inLineComment = true;
      index++;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      stack.push({ delimiter: char, index });
      continue;
    }
    const expected = char === ")" ? "(" : char === "]" ? "[" : char === "}" ? "{" : null;
    if (expected && stack[stack.length - 1]?.delimiter === expected) stack.pop();
  }
  const open = stack[stack.length - 1];
  if (!open || open.delimiter !== "(") return null;
  const before = text.slice(0, open.index).trimEnd();
  return /(?:#(?:set|show)\s+|#)?[\p{L}_][\p{L}\p{M}\p{N}_.-]*$/u.test(before)
    ? open.index
    : null;
}

export function isInsideTypstFunctionArgumentsAt(
  doc: Text,
  cursorPosition: number
): boolean {
  return innermostTypstFunctionArgumentStart(doc, cursorPosition) !== null;
}

export function isTypstFunctionArgumentContextAt(
  doc: Text,
  cursorPosition: number,
  allowIdentifier = false
): boolean {
  const argumentStart = innermostTypstFunctionArgumentStart(doc, cursorPosition);
  if (argumentStart === null) return false;
  const segment = doc.sliceString(argumentStart + 1, cursorPosition);
  const currentSlot = segment.slice(Math.max(segment.lastIndexOf(","), segment.lastIndexOf("\n")) + 1);
  return allowIdentifier
    ? /^\s*[\p{L}_][\p{L}\p{M}\p{N}_-]*\s*$/u.test(currentSlot)
      || /^\s*$/u.test(currentSlot)
    : /^\s*$/u.test(currentSlot);
}

export function isTypstFunctionArgumentValueContextAt(
  doc: Text,
  cursorPosition: number
): boolean {
  const argumentStart = innermostTypstFunctionArgumentStart(doc, cursorPosition);
  if (argumentStart === null) return false;
  const segment = doc.sliceString(argumentStart + 1, cursorPosition);
  const currentSlot = segment.slice(Math.max(segment.lastIndexOf(","), segment.lastIndexOf("\n")) + 1);
  return /^\s*[\p{L}_][\p{L}\p{M}\p{N}_-]*\s*:\s*[^,]*$/u.test(currentSlot);
}

export function quotedTypstArgumentValueStart(
  doc: Text,
  cursorPosition: number
): number | null {
  const argumentStart = innermostTypstFunctionArgumentStart(doc, cursorPosition);
  if (argumentStart === null || !isTypstFunctionArgumentValueContextAt(doc, cursorPosition)) return null;
  const line = doc.lineAt(cursorPosition);
  const cursor = cursorPosition - line.from;
  let openingQuote = -1;
  let quoted = false;
  for (let index = 0; index < cursor; index++) {
    if (line.text[index] !== '"' || isEscaped(line.text, index)) continue;
    quoted = !quoted;
    openingQuote = quoted ? index : -1;
  }
  if (!quoted || openingQuote < 0) return null;

  const absoluteOpeningQuote = line.from + openingQuote;
  const beforeQuote = doc.sliceString(argumentStart + 1, absoluteOpeningQuote);
  const slotStart = Math.max(beforeQuote.lastIndexOf(","), beforeQuote.lastIndexOf("\n")) + 1;
  return /^\s*[\p{L}_][\p{L}\p{M}\p{N}_-]*\s*:\s*$/u.test(beforeQuote.slice(slotStart))
    ? line.from + openingQuote
    : null;
}

export function typstCompletionRequestPosition(
  doc: Text,
  cursorPosition: number,
  isFunctionArgumentStart: boolean
): number {
  if (!isFunctionArgumentStart || cursorPosition <= 0) return cursorPosition;
  const after = doc.sliceString(cursorPosition, cursorPosition + 1);
  const before = doc.sliceString(cursorPosition - 1, cursorPosition);
  // Tinymist may return no fields for an empty argument slot when the query
  // sits directly before `)`. Query immediately before the final whitespace
  // instead, which presents the same slot with recoverable trailing space.
  // Completion edits still use CodeMirror's real caret range.
  return after === ")" && /\s/u.test(before)
    ? cursorPosition - 1
    : cursorPosition;
}

export function isTypstRuleTargetAt(
  lineText: string,
  cursor: number
): boolean {
  const boundedCursor = Math.max(0, Math.min(cursor, lineText.length));
  return /#(?:set|show)\s+[\p{L}\p{M}\p{N}_.-]*$/u.test(
    lineText.slice(0, boundedCursor)
  );
}

export function isTypstMemberAccessAt(
  lineText: string,
  cursor: number
): boolean {
  const boundedCursor = Math.max(0, Math.min(cursor, lineText.length));
  const before = lineText.slice(0, boundedCursor);
  const memberSuffix = /(?:\.[\p{L}\p{M}\p{N}_-]*)+$/u.exec(before);
  if (!memberSuffix || memberSuffix.index === undefined) return false;

  const hash = before.lastIndexOf("#", memberSuffix.index);
  if (hash < 0) return false;
  const receiver = before.slice(hash + 1, memberSuffix.index);

  // Keep ordinary markup such as `See example.com` out of implicit Typst
  // completion. These forms are expressions that can own fields or methods.
  return /^(?:"(?:\\.|[^"\\])*"|\d+(?:\.\d+)?|[\p{L}_][\p{L}\p{M}\p{N}_-]*|\([^()\r\n]*\)|\[[^\]\r\n]*\])(?:\([^()\r\n]*\))?(?:\.[\p{L}_][\p{L}\p{M}\p{N}_-]*(?:\([^()\r\n]*\))?)*$/u.test(receiver);
}

export function liveTypstMemberCompletionEditOffsets(
  doc: Text,
  cursorPosition: number
): { from: number; to: number } | null {
  const line = doc.lineAt(cursorPosition);
  const cursor = cursorPosition - line.from;
  if (!isTypstMemberAccessAt(line.text, cursor)) return null;
  const suffix = /[\p{L}\p{M}\p{N}_-]*$/u.exec(line.text.slice(0, cursor));
  if (!suffix || suffix.index === undefined) return null;
  return { from: line.from + suffix.index, to: cursorPosition };
}

export function liveTypstCompletionEditOffsets(
  doc: Text,
  cursorPosition: number
): { from: number; to: number } | null {
  const line = doc.lineAt(cursorPosition);
  const cursor = cursorPosition - line.from;
  const identifier = /[\p{L}\p{M}\p{N}_-]/u;
  let from = cursor;
  let to = cursor;

  while (from > 0 && identifier.test(line.text[from - 1])) from--;
  if (from > 0 && line.text[from - 1] === "#") from--;
  while (to < line.text.length && identifier.test(line.text[to])) to++;

  return from < to
    ? { from: line.from + from, to: line.from + to }
    : null;
}

export function normalizeCallableCompletionSnippet(
  insertion: string,
  kind: number | undefined,
  detail: string | undefined
): { template: string; opensArguments: boolean } {
  const callable = kind === 2
    || kind === 3
    || kind === 4
    || /^\s*\([^)]*\)\s*=>/s.test(detail ?? "");
  if (!callable) return { template: insertion, opensArguments: false };

  // Tinymist's `page` completion is `page()${1:}`, which deliberately puts
  // the cursor after the call. Move that empty stop into the parentheses.
  const trailingStop = /\(\)\$\{\d+:\}(\s*)$/.exec(insertion);
  if (trailingStop && trailingStop.index !== undefined) {
    return {
      template: `${insertion.slice(0, trailingStop.index)}(\${})${trailingStop[1]}`,
      opensArguments: true
    };
  }

  // Some callable entries, notably the primary `figure` item, contain only
  // the function name. Give them the same editable call shape.
  if (/^#?[\p{L}\p{M}\p{N}_.-]+$/u.test(insertion)) {
    return { template: `${insertion}(\${})`, opensArguments: true };
  }

  // Preserve Tinymist's richer snippets, while recognizing an existing empty
  // first argument such as `circle(${1:})`.
  return {
    template: insertion,
    opensArguments: /\(\$\{\d*:\}\)/.test(insertion)
      || /\(\$\{\}\)/.test(insertion)
  };
}

export function completedEmptyCallCaret(
  text: string,
  completionLabel: string,
  searchFrom = 0
): number | null {
  const name = completionLabel
    .replace(/^#/, "")
    .match(/^[\p{L}\p{M}\p{N}_-]+/u)?.[0];
  if (!name) return null;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundedFrom = Math.max(0, Math.min(searchFrom, text.length));
  const match = new RegExp(`#?${escapedName}\\(\\)`, "u").exec(text.slice(boundedFrom));
  return match && match.index !== undefined
    ? boundedFrom + match.index + match[0].length - 1
    : null;
}

/**
 * Tinymist may return global symbols first and append the relevant named
 * arguments after them when explicit completion follows argument whitespace.
 * The appended argument segment restarts sortText at the highest priority.
 * Keep only that segment so globals cannot become the active suggestions.
 */
export function preferContextualArgumentCompletions(
  items: LspCompletionItem[]
): LspCompletionItem[] {
  const contextual = contextualCompletionSuffix(items);
  return contextual.length < items.length
    && contextual.every(isNamedArgumentCompletion)
    ? contextual
    : items;
}

function contextualCompletionSuffix(items: LspCompletionItem[]): LspCompletionItem[] {
  let contextualStart = -1;
  for (let index = 1; index < items.length; index++) {
    const previous = items[index - 1].sortText;
    const current = items[index].sortText;
    if (previous !== undefined && current !== undefined && current.localeCompare(previous) < 0) {
      contextualStart = index;
    }
  }
  return contextualStart > 0 ? items.slice(contextualStart) : items;
}

export function preferContextualArgumentValueCompletions(
  items: LspCompletionItem[]
): LspCompletionItem[] {
  const contextual = contextualCompletionSuffix(items);
  return contextual.length < items.length ? contextual : [];
}

function textEditFromDefault(range: LspEditRange | undefined, newText: string): LspTextEdit | undefined {
  if (!range) return undefined;
  if ("start" in range) return { newText, range };
  return { newText, insert: range.insert, replace: range.replace };
}

export function lspCompletionEditOffsets(
  doc: Text,
  textEdit: LspTextEdit | undefined,
  characterOffset: (text: string, character: number) => number
): { from: number; to: number } | null {
  const range = textEdit?.range ?? textEdit?.replace ?? textEdit?.insert;
  if (!range) return null;
  const offset = (position: LspPosition): number => {
    const line = doc.line(Math.max(1, Math.min(position.line + 1, doc.lines)));
    return line.from + characterOffset(line.text, position.character ?? 0);
  };
  const from = offset(range.start);
  const to = offset(range.end);
  return from <= to ? { from, to } : null;
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) slashes++;
  return slashes % 2 === 1;
}

export function fontCompletionValueStart(doc: Text, cursorPosition: number): number | null {
  const line = doc.lineAt(cursorPosition);
  const cursor = cursorPosition - line.from;
  const quotes: number[] = [];
  for (let index = 0; index < cursor; index++) {
    if (line.text[index] === '"' && !isEscaped(line.text, index)) quotes.push(index);
  }
  if (quotes.length % 2 === 0) return null;
  const openingQuote = quotes[quotes.length - 1];
  return /\bfont\s*:\s*$/.test(line.text.slice(0, openingQuote))
    ? line.from + openingQuote + 1
    : null;
}

export function quotedCompletionEditOffsets(
  doc: Text,
  cursorPosition: number,
  insertion: string
): { from: number; to: number } | null {
  const line = doc.lineAt(cursorPosition);
  const cursor = cursorPosition - line.from;
  const quotes: number[] = [];
  for (let index = 0; index < cursor; index++) {
    if (line.text[index] === '"' && !isEscaped(line.text, index)) quotes.push(index);
  }
  let closing = -1;
  let opening = -1;
  if (quotes.length % 2 === 1) {
    opening = quotes[quotes.length - 1];
    for (let index = cursor; index < line.text.length; index++) {
      if (line.text[index] === '"' && !isEscaped(line.text, index)) {
        closing = index;
        break;
      }
    }
  } else if (quotes.length >= 2 && quotes[quotes.length - 1] === cursor - 1) {
    opening = quotes[quotes.length - 2];
    closing = quotes[quotes.length - 1];
  }
  if (opening < 0) return null;
  const replacesOpeningQuote = insertion.startsWith('"');
  const replacesClosingQuote = insertion.endsWith('"');
  return {
    from: line.from + opening + (replacesOpeningQuote ? 0 : 1),
    to: closing >= 0
      ? line.from + closing + (replacesClosingQuote ? 1 : 0)
      : cursorPosition
  };
}

export function fontCompletionEditOffsets(
  doc: Text,
  cursorPosition: number,
  insertion: string
): { from: number; to: number } | null {
  const edit = quotedCompletionEditOffsets(doc, cursorPosition, insertion);
  if (!edit) return null;
  const openingQuote = doc.sliceString(edit.from, edit.from + 1) === '"'
    ? edit.from
    : edit.from - 1;
  if (openingQuote < 0 || doc.sliceString(openingQuote, openingQuote + 1) !== '"') return null;
  const line = doc.lineAt(openingQuote);
  const beforeQuote = doc.sliceString(line.from, openingQuote);
  return /\bfont\s*:\s*$/.test(beforeQuote) ? edit : null;
}

export function completionEditOffsets(
  doc: Text,
  cursorPosition: number,
  insertion: string,
  textEdit: LspTextEdit | undefined,
  characterOffset: (text: string, character: number) => number
): { from: number; to: number } | null {
  return fontCompletionEditOffsets(doc, cursorPosition, insertion)
    ?? quotedCompletionEditOffsets(doc, cursorPosition, insertion)
    ?? lspCompletionEditOffsets(doc, textEdit, characterOffset);
}

export function contextualCompletionEditOffsets(
  doc: Text,
  cursorPosition: number,
  insertion: string,
  textEdit: LspTextEdit | undefined,
  characterOffset: (text: string, character: number) => number,
  localFrom: number,
  localTo: number,
  preferLocalTokenRange: boolean
): { from: number; to: number } {
  // CodeMirror already tracks the complete live identifier for both
  // `#identifier` and rule targets such as `#set identifier`. Tinymist can
  // return an insertion-only or stale partial edit after an asynchronous
  // refresh, which would otherwise produce `#page()pag` or `#set page()ge`.
  // Keep the server's inserted text, but replace the authoritative local
  // token range. Quoted/font completions opt out because they intentionally
  // replace a wider value range.
  if (preferLocalTokenRange) return { from: localFrom, to: localTo };
  return completionEditOffsets(
    doc,
    cursorPosition,
    insertion,
    textEdit,
    characterOffset
  ) ?? { from: localFrom, to: localTo };
}

export function displayLabelForHashPrefix(label: string, type: string, isHashPrefix: boolean | undefined): string {
  return isHashPrefix
    && !label.startsWith('#')
    && (type === 'function' || type === 'keyword' || type === 'module' || type === 'variable')
    ? `#${label}`
    : label;
}

export function applyTextForHashPrefix(apply: string, type: string, isHashPrefix: boolean | undefined, hasServerEdit: boolean): string {
  if (
    isHashPrefix
    && !hasServerEdit
    && !apply.startsWith('#')
    && (type === 'function' || type === 'keyword' || type === 'module' || type === 'variable')
  ) {
    return `#${apply}`;
  }
  return apply;
}

export const typstSnippets = [
  // Document structure
  snippetCompletion("#set document(title: \"${title}\")\n", { label: "#document", detail: "Document Properties" }),
  snippetCompletion("#set page(margin: ${margin}, paper: \"${paper}\")\n", { label: "#page", detail: "Page setup" }),
  snippetCompletion("#set text(font: \"${font}\", size: ${11pt})\n", { label: "#text", detail: "Text Properties" }),
  snippetCompletion("#set heading(numbering: \"${1.}\")\n", { label: "#heading setup", detail: "Heading Numbering" }),
  snippetCompletion(
    "#block[\n  #set par(\n    justification-limits: (\n      spacing: (min: ${85%}, max: ${115%}),\n      tracking: (min: ${-0.8pt}, max: ${0pt}),\n    ),\n  )\n  ${content}\n]",
    { label: "#par justification limits", detail: "Scoped paragraph justification" }
  ),
  
  // Elements
  snippetCompletion("#align(${center})[\n  ${content}\n]\n", { label: "#align", detail: "Align content" }),
  snippetCompletion("#import \"${pkg}\": *\n", { label: "#import", detail: "Import package" }),
  snippetCompletion("= ${heading}\n", { label: "= Heading 1", detail: "Level 1 Heading" }),
  snippetCompletion("== ${heading}\n", { label: "== Heading 2", detail: "Level 2 Heading" }),
  snippetCompletion("#figure(\n  image(\"${path}\", width: ${80%}),\n  caption: [${caption}],\n)\n", { label: "#figure", detail: "Image Figure" }),
  snippetCompletion("#table(\n  columns: (${columns}),\n  align: ${center},\n  [${A}], [${B}],\n)\n", { label: "#table", detail: "Table" }),
  snippetCompletion("#grid(\n  columns: (${columns}),\n  gutter: ${1em},\n  [${cell 1}], [${cell 2}],\n)\n", { label: "#grid", detail: "Grid layout" }),
  
  // Math & Code
  snippetCompletion("$ ${math} $\n", { label: "math inline", detail: "Inline Math" }),
  snippetCompletion("$ ${math} $\n", { label: "$", detail: "Inline Math" }),
  snippetCompletion("$ \n  ${math} \n$\n", { label: "math block", detail: "Math Block" }),
  snippetCompletion("```${lang}\n${code}\n```\n", { label: "```", detail: "Code Block" }),
  
  // Typography
  snippetCompletion("*${bold}*", { label: "*bold*", detail: "Bold text" }),
  snippetCompletion("_${italic}_", { label: "_italic_", detail: "Italic text" }),
  snippetCompletion("#strong[${bold}]", { label: "#strong", detail: "Strong text" }),
  snippetCompletion("#emph[${italic}]", { label: "#emph", detail: "Emphasized text" }),
  
  // Math common
  snippetCompletion("frac(${num}, ${den})", { label: "frac", detail: "Fraction" }),
  snippetCompletion("sum_(${i=1})^(${n})", { label: "sum", detail: "Summation" }),
  snippetCompletion("integral_(${a})^(${b})", { label: "integral", detail: "Integral" }),
];

export function typstCompletions(context: CompletionContext) {
  const word = context.matchBefore(/[\p{L}\p{M}\p{N}_#=.-]+/u);
  if (!word) {
    if (context.explicit) {
      return {
        from: context.pos,
        options: typstSnippets,
        validFor: typstCompletionValidFor
      };
    }
    return null;
  }
  return {
    from: word.from,
    options: typstSnippets,
    validFor: typstCompletionValidFor
  };
}

export function allowsLanguageWordCompletionOnLine(lineText: string, wordFrom: number): boolean {
  const beforeWord = lineText.slice(0, Math.max(0, Math.min(wordFrom, lineText.length)));
  if (isInsideTypstCodeString(lineText, wordFrom)) return false;
  const lastHash = beforeWord.lastIndexOf("#");
  if (lastHash === -1) return true;
  const lastOpenContent = beforeWord.lastIndexOf("[");
  const lastCloseContent = beforeWord.lastIndexOf("]");
  return Math.max(lastOpenContent, lastCloseContent) > lastHash;
}

function isInsideTypstCodeString(lineText: string, position: number): boolean {
  const before = lineText.slice(0, Math.max(0, Math.min(position, lineText.length)));
  const quotes: number[] = [];
  for (let index = 0; index < before.length; index++) {
    if (before[index] === '"' && !isEscaped(before, index)) quotes.push(index);
  }
  if (quotes.length % 2 === 0) return false;
  const openQuote = quotes[quotes.length - 1];
  if (before.slice(0, openQuote).includes("#")) return true;
  const after = lineText.slice(position);
  const closeQuote = firstUnescapedQuote(after);
  if (closeQuote === null) return false;
  const afterClose = after.slice(closeQuote + 1).trimStart();
  return /^[),:\]]/.test(afterClose);
}

function firstUnescapedQuote(text: string): number | null {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"' && !isEscaped(text, index)) return index;
  }
  return null;
}

function getCmCompletionType(kind?: number): string {
  switch (kind) {
    case 1: return "text";
    case 2: return "method";
    case 3: return "function";
    case 4: return "constructor";
    case 5: return "field";
    case 6: return "variable";
    case 7: return "class";
    case 8: return "interface";
    case 9: return "module";
    case 10: return "property";
    case 14: return "keyword";
    default: return "variable";
  }
}

export type ProviderCapabilities = LanguageProviderCapabilities;

export function createTypstAutocomplete(
  getClient: () => TinymistLspClient | undefined,
  getUri: () => string,
  flushLspSync: () => void | Promise<void>,
  languageWordCompletion = true,
  getProviders: () => ProviderCapabilities[] = () => [],
  getLanguageCompletionProvider?: (providers: ProviderCapabilities[]) => CompletionProviderSelection | null,
  getLanguageCompletionGeneration?: () => number,
  onLanguageCompletionPerformance?: (milliseconds: number) => void,
  onTypstCompletionTrace?: (message: string) => void,
) {
  return autocompletion({
    override: [
      async (context: CompletionContext) => {
        const insideTypstFunctionArguments = isInsideTypstFunctionArgumentsAt(
          context.state.doc,
          context.pos
        );
        if (languageWordCompletion
          && !insideTypstFunctionArguments
          && !context.view?.composing
          && context.state.selection.ranges.length === 1) {
          const languageCompletionStartedAt = performance.now();
          const matches = getProviders()
            .filter(provider => provider.supportsCompletion === true)
            .map(provider => ({
              provider,
              word: context.matchBefore(new RegExp(provider.pattern + "$", "u")),
            }))
            .filter((match): match is { provider: ProviderCapabilities; word: NonNullable<typeof match.word> } =>
              match.word !== null
            );
          const selected = getLanguageCompletionProvider?.(matches.map(match => match.provider)) ?? null;
          const provider = selected?.provider ?? null;
          const match = provider ? matches.find(candidate => candidate.provider.id === provider.id) : null;
          if (selected && provider && match) {
            const line = context.state.doc.lineAt(context.pos);
            // A script provider can match a Typst identifier such as the `p`
            // in `#set p`. In that case, skip only language-word completion
            // and continue below to Tinymist's syntax completion source.
            if (allowsLanguageWordCompletionOnLine(line.text, match.word.from - line.from)) {
              try {
              const documentIdentity = context.state.doc;
              const inputGeneration = selected.generation;
              const completion = await invoke<LanguageCompletionResponse | null>("complete_language_word", {
                request: {
                  provider: provider.id,
                  text: match.word.text,
                  cursorUtf16: match.word.text.length,
                  limit: 10
                }
              });
              onLanguageCompletionPerformance?.(performance.now() - languageCompletionStartedAt);
              if (context.view && (context.view.state.doc !== documentIdentity
                || context.view.state.selection.main.head !== context.pos
                || context.view.composing)) return null;
              if (inputGeneration !== undefined && getLanguageCompletionGeneration?.() !== inputGeneration) return null;
              const replacement = languageCompletionRange(match.word.from, match.word.text.length, completion);
              if (completion && replacement && completion.options.length > 0) {
                return {
                  from: replacement.from,
                  options: completion.options.map(w => ({
                    label: w,
                    type: "text",
                    detail: `${completion.provider} · ${selected.languageTag} (document script)`
                  })),
                  // Results are deliberately bounded and ranked for the current
                  // segmented prefix, so every typed character must query again.
                  validFor: languageCompletionValidFor
                };
              }
              } catch (e) {
                console.warn(`${provider.id} autocomplete error`, e);
              }
            }
          }
        }

        const activeCompletionLine = context.state.doc.lineAt(context.pos);
        const completionColumn = context.pos - activeCompletionLine.from;
        const isMemberAccess = isTypstMemberAccessAt(
          activeCompletionLine.text,
          completionColumn
        );
        const fontValueFrom = fontCompletionValueStart(context.state.doc, context.pos);
        const traceRelevant = context.explicit
          || context.state.doc.lineAt(context.pos).text.includes("#");
        if (traceRelevant) {
          const line = context.state.doc.lineAt(context.pos);
          onTypstCompletionTrace?.(
            `Completion source entered: explicit=${context.explicit}; line=${line.number}; column=${context.pos - line.from}; text=${JSON.stringify(line.text)}.`
          );
        }
        if (!context.explicit) {
          const lineStr = activeCompletionLine.text;
          const col = completionColumn;
          const textBefore = lineStr.slice(0, col);
          const isEmptyFunctionCall = isEmptyTypstFunctionCallAt(lineStr, col);
          
          // Only trigger autocomplete implicitly on word characters or
          // context-specific trigger characters. A comma opens the next
          // named-argument slot only when it belongs to a Typst function.
          const lastChar = textBefore.slice(-1);
          const isFunctionArgumentTrigger = (lastChar === "," || lastChar === " ")
            && isTypstFunctionArgumentContextAt(
              context.state.doc,
              context.pos
            );
          if (!/[\w#\.@-]/.test(lastChar)
            && !(lastChar === " " && fontValueFrom !== null)
            && !isFunctionArgumentTrigger
            && !isEmptyFunctionCall) {
            return null;
          }
          
          const isHashWord = /#[\w-]*$/.test(textBefore);
          const isSetShow = /^\s*#(?:set|show)\b/.test(textBefore);
          
          const docBefore = context.state.doc.sliceString(0, context.pos);
          const openBraces = (docBefore.match(/\{/g) || []).length;
          const closeBraces = (docBefore.match(/\}/g) || []).length;
          const inCodeBlock = openBraces > closeBraces;
          
          if (!isHashWord
            && !isSetShow
            && !isMemberAccess
            && !inCodeBlock
            && !isEmptyFunctionCall
            && !isFunctionArgumentTrigger) {
            if (traceRelevant) {
              onTypstCompletionTrace?.(
                `Implicit completion rejected by syntax gate: hashWord=${isHashWord}; rule=${isSetShow}; member=${isMemberAccess}; codeBlock=${inCodeBlock}; emptyCall=${isEmptyFunctionCall}.`
              );
            }
            return null;
          }
        }

        const activeLine = activeCompletionLine;
        const isEmptyFunctionCall = isEmptyTypstFunctionCallAt(
          activeLine.text,
          context.pos - activeLine.from
        );
        const isFunctionArgumentStart = isEmptyFunctionCall
          || isTypstFunctionArgumentContextAt(
            context.state.doc,
            context.pos,
            context.explicit
          );
        const isFunctionArgumentValue = isTypstFunctionArgumentValueContextAt(
          context.state.doc,
          context.pos
        );
        const quotedArgumentValueStart = quotedTypstArgumentValueStart(
          context.state.doc,
          context.pos
        );
        const isRuleTarget = isTypstRuleTargetAt(
          activeLine.text,
          context.pos - activeLine.from
        );
        const fallbackCompletions = () => isFunctionArgumentStart
          || isFunctionArgumentValue
          || isMemberAccess
          ? null
          : typstCompletions(context);

        const client = getClient();
        const uri = getUri();
        if (!client || !uri) return fallbackCompletions();
        
        const doc = context.state.doc;
        const requestPosition = quotedArgumentValueStart
          ?? typstCompletionRequestPosition(doc, context.pos, isFunctionArgumentStart);
        const position = client.lspPositionFromEditorPosition(doc, requestPosition);
        
        try {
          // Force flush any pending LSP document changes so the server completes
          // against the same text CodeMirror is showing.
          await flushLspSync();
          if (traceRelevant) {
            onTypstCompletionTrace?.(
              `Requesting Tinymist completion: uri=${uri}; line=${position.line}; character=${position.character ?? 0}; aborted=${context.aborted}.`
            );
          }

          const response = await client.request<LspCompletionResponse>("textDocument/completion", {
            textDocument: { uri },
            position,
            context: {
              triggerKind: 1
            }
          });
          
          if (!response) return fallbackCompletions();
          
          const responseItems = Array.isArray(response) ? response : response.items;
          const itemDefaults = Array.isArray(response) ? undefined : response.itemDefaults;
          if (traceRelevant) {
            onTypstCompletionTrace?.(
              `Tinymist completion returned: count=${responseItems?.length ?? 0}; aborted=${context.aborted}; labels=${JSON.stringify(responseItems?.slice(0, 8).map(item => item.label) ?? [])}.`
            );
          }
          if (!responseItems || responseItems.length === 0) return fallbackCompletions();
          const memberItems = isMemberAccess
            ? responseItems.filter(isDirectMemberCompletion)
            : responseItems;
          const contextualItems = isFunctionArgumentStart
            ? memberItems.filter(isNamedArgumentCompletion)
            : isFunctionArgumentValue
              ? preferContextualArgumentValueCompletions(memberItems)
              : isRuleTarget
                ? memberItems
                : preferContextualArgumentCompletions(memberItems);
          const rawVariantsByFamily = typstCompletionVariantsByFamily(
            contextualItems.map(item => item.label)
          );
          const items = deduplicateTypstCompletionVariants(contextualItems);
          if (items.length === 0) return null;
          
          // A member completion replaces only the identifier after the final
          // dot. Including the dot makes CodeMirror filter `len` against
          // `.le`, hiding every otherwise valid Tinymist result.
          const word = isMemberAccess
            ? context.matchBefore(/[\p{L}\p{M}\p{N}_-]*/u)
            : context.matchBefore(/#?[\p{L}\p{M}\p{N}_.-]*/u);
          const isHashPrefix = word?.text.startsWith('#');
          const preferLocalTokenRange = fontValueFrom === null
            && (Boolean(word?.text) || isFunctionArgumentStart);
          const variantsByFamily = new Map<string, Set<TypstCompletionSyntaxVariant>>();
          for (const item of items) {
            const syntax = effectiveTypstCompletionSyntax(item, rawVariantsByFamily);
            const variants = variantsByFamily.get(syntax.family)
              ?? new Set<TypstCompletionSyntaxVariant>();
            variants.add(syntax.variant);
            variantsByFamily.set(syntax.family, variants);
          }
          const completionPreferences = isFunctionArgumentValue
            ? {}
            : readTypstCompletionPreferences();
          const allowsAdaptivePreference = !isFunctionArgumentStart
            && !isFunctionArgumentValue
            && !isMemberAccess
            && fontValueFrom === null;
          
          const options: Completion[] = items.map(item => {
            const syntax = effectiveTypstCompletionSyntax(item, rawVariantsByFamily);
            const preferenceLabel = syntax.variant === "bare"
              ? syntax.family
              : `${syntax.family}.${syntax.variant}`;
            let label = syntax.displayLabel;
            let detail = item.labelDetails?.description ?? item.labelDetails?.detail ?? item.detail;
            let info = typeof item.documentation === 'string' ? item.documentation : item.documentation?.value;
            const type = getCmCompletionType(item.kind);
            
            // VS Code style: keep detail short, move long text to info
            if (detail && detail.length > 30 && detail.includes(' ')) {
                if (!info) info = detail;
                detail = undefined;
            }
            
            const defaultApply = item.insertText ?? label;
            const textEdit = item.textEdit ?? textEditFromDefault(itemDefaults?.editRange, defaultApply);
            const insertTextFormat = item.insertTextFormat ?? itemDefaults?.insertTextFormat;
            let apply = textEdit?.newText ?? defaultApply;
            
            label = displayLabelForHashPrefix(label, type, isHashPrefix);
            apply = applyTextForHashPrefix(
              apply,
              type,
              isHashPrefix,
              Boolean(textEdit) && !isHashPrefix
            );
            const callableSnippet = normalizeCallableCompletionSnippet(
              apply,
              item.kind,
              item.detail ?? item.labelDetails?.description
            );
            const opensArgumentValueCompletion = isFunctionArgumentStart
              && isNamedArgumentCompletion(item);
            if (insertTextFormat === 2 || callableSnippet.opensArguments) {
              const completion = snippetCompletion(callableSnippet.template, {
                label,
                detail,
                info,
                type,
                sortText: item.sortText,
                boost: typstCompletionPreferenceBoost(
                  preferenceLabel,
                  variantsByFamily,
                  completionPreferences
                )
              });
              const snippetApply = completion.apply;
              if (typeof snippetApply !== "function") return completion;
              const wrappedCompletion: Completion = {
                ...completion,
                apply(view, selected, from, to) {
                  const liveTokenEdit = fontValueFrom === null && !isMemberAccess
                    ? liveTypstCompletionEditOffsets(
                      view.state.doc,
                      view.state.selection.main.head
                    )
                    : null;
                  const edit = (isMemberAccess
                    ? liveTypstMemberCompletionEditOffsets(
                      view.state.doc,
                      view.state.selection.main.head
                    )
                    : null) ?? contextualCompletionEditOffsets(
                    view.state.doc,
                    to,
                    apply,
                    textEdit,
                    (text, character) => client.stringOffsetFromLspCharacter(text, character),
                    liveTokenEdit?.from ?? from,
                    liveTokenEdit?.to ?? to,
                    Boolean(liveTokenEdit) || preferLocalTokenRange
                  );
                  const documentLengthBeforeApply = view.state.doc.length;
                  snippetApply(view, selected, edit.from, edit.to);
                  if (isFunctionArgumentValue && !callableSnippet.opensArguments) {
                    const insertedLength = view.state.doc.length
                      - (documentLengthBeforeApply - (edit.to - edit.from));
                    const anchor = edit.from + insertedLength;
                    if (view.state.selection.main.anchor !== anchor) {
                      view.dispatch({ selection: { anchor } });
                    }
                  }
                  if (allowsAdaptivePreference) {
                    recordTypstCompletionPreference(preferenceLabel);
                  }
                  if (opensArgumentValueCompletion) {
                    window.setTimeout(() => {
                      view.dispatch({ selection: view.state.selection });
                      startCompletion(view);
                    }, 50);
                  }
                  if (callableSnippet.opensArguments) {
                    const line = view.state.doc.lineAt(edit.from);
                    const caretInLine = completedEmptyCallCaret(
                      line.text,
                      label,
                      edit.from - line.from
                    );
                    if (caretInLine !== null) {
                      const anchor = line.from + caretInLine;
                      if (view.state.selection.main.anchor !== anchor) {
                        view.dispatch({ selection: { anchor } });
                      }
                      window.setTimeout(() => {
                        view.dispatch({ selection: view.state.selection });
                        startCompletion(view);
                      }, 50);
                    }
                  }
                }
              };
              return wrappedCompletion;
            }

            return {
              label,
              detail,
              info,
              type,
              sortText: item.sortText,
              boost: typstCompletionPreferenceBoost(
                preferenceLabel,
                variantsByFamily,
                completionPreferences
              ),
              apply(view, _selected, from, to) {
                const liveTokenEdit = fontValueFrom === null && !isMemberAccess
                  ? liveTypstCompletionEditOffsets(
                    view.state.doc,
                    view.state.selection.main.head
                  )
                  : null;
                const replacement = (isMemberAccess
                  ? liveTypstMemberCompletionEditOffsets(
                    view.state.doc,
                    view.state.selection.main.head
                  )
                  : null) ?? contextualCompletionEditOffsets(
                  view.state.doc,
                  to,
                  apply,
                  textEdit,
                  (text, character) => client.stringOffsetFromLspCharacter(text, character),
                  liveTokenEdit?.from ?? from,
                  liveTokenEdit?.to ?? to,
                  Boolean(liveTokenEdit) || preferLocalTokenRange
                );
                view.dispatch({
                  changes: { from: replacement.from, to: replacement.to, insert: apply },
                  selection: { anchor: replacement.from + apply.length },
                  userEvent: "input.complete"
                });
                if (allowsAdaptivePreference) {
                  recordTypstCompletionPreference(preferenceLabel);
                }
                if (opensArgumentValueCompletion) {
                  window.setTimeout(() => {
                    view.dispatch({ selection: view.state.selection });
                    startCompletion(view);
                  }, 50);
                }
              }
            };
          });
          
          const result = {
            from: quotedArgumentValueStart !== null
              ? quotedArgumentValueStart + 1
              : fontValueFrom ?? word?.from ?? context.pos,
            options,
            validFor: fontValueFrom !== null || quotedArgumentValueStart !== null
              ? /^[^"\r\n]*$/
              : isMemberAccess
                ? typstMemberCompletionValidFor
                : isFunctionArgumentStart
                  ? typstArgumentCompletionValidFor
                  : typstCompletionValidFor
          };
          if (traceRelevant) {
            onTypstCompletionTrace?.(
              `Installing completion result: from=${result.from}; cursor=${context.pos}; options=${options.length}; aborted=${context.aborted}.`
            );
          }
          return result;
          
        } catch (e) {
          console.warn("LSP completion error", e);
          if (traceRelevant) onTypstCompletionTrace?.(`Tinymist completion failed: ${String(e)}.`);
          return fallbackCompletions();
        }
      }
    ]
  });
}
