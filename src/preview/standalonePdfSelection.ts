export type StandalonePdfSelectionGeometry = {
  from: number;
  to: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type StandalonePdfSelectionItem = {
  text: string;
  hasEOL: boolean;
  baselineY: number | null;
  height: number | null;
  semanticBlockId?: number | null;
  semanticRole?: string | null;
  semanticTableId?: number | null;
  semanticRowId?: number | null;
  semanticCellId?: number | null;
  semanticFigureId?: number | null;
  searchGeometry?: StandalonePdfSelectionGeometry[];
  styleRanges?: StandalonePdfSelectionStyleRange[];
};

export type StandalonePdfSelectionStyleRange = {
  from: number;
  to: number;
  fontFamily?: string | null;
  fontSize?: number | null;
  fontWeight?: number | null;
  italic?: boolean;
  color?: string | null;
  direction?: "ltr" | "rtl";
};

export type StandalonePdfFormattedSelection = {
  plainText: string;
  html: string;
};

export type StandalonePdfSelectionEndpoint = {
  pageNo: number;
  itemIndex: number;
  geometryIndex: number;
};

export type StandalonePdfSelectionFragment = {
  pageNo: number;
  itemIndex: number;
  from: number;
  to: number;
};

export type StandalonePdfSelectionPage = {
  textItems: readonly StandalonePdfSelectionItem[];
};

type IndexedUnit = StandalonePdfSelectionEndpoint & {
  geometry: StandalonePdfSelectionGeometry;
};

/**
 * Returns a bounded per-frame scroll delta after a selection pointer passes
 * above or below the standalone PDF viewport. Remaining inside the viewport
 * never scrolls, while moving farther outside accelerates predictably.
 */
export function standalonePdfSelectionAutoScrollDelta(
  pointerY: number,
  viewportHeight: number,
): number {
  if (!Number.isFinite(pointerY) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
  const overflow = pointerY < 0
    ? pointerY
    : pointerY > viewportHeight
      ? pointerY - viewportHeight
      : 0;
  if (overflow === 0) return 0;
  const magnitude = Math.min(32, Math.max(4, Math.abs(overflow) * 0.35));
  return Math.sign(overflow) * magnitude;
}

/**
 * Resolves a PDF-page point to one indivisible extracted logical unit.
 *
 * Enhanced Unicode PDFs can associate multiple Unicode code points with one
 * painted glyph. The unit must stay atomic: allowing a DOM selection to stop
 * inside it produces a selection rectangle for the whole glyph but copies
 * only part of its logical text.
 */
export function hitTestStandalonePdfSelection(
  pageNo: number,
  items: readonly StandalonePdfSelectionItem[],
  x: number,
  y: number,
  maxDistance = Number.POSITIVE_INFINITY,
): StandalonePdfSelectionEndpoint | null {
  let best: { endpoint: StandalonePdfSelectionEndpoint; distance: number } | null = null;
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const geometry = items[itemIndex].searchGeometry ?? [];
    for (let geometryIndex = 0; geometryIndex < geometry.length; geometryIndex += 1) {
      const rect = geometry[geometryIndex];
      const right = rect.left + rect.width;
      const bottom = rect.top + rect.height;
      const dx = x < rect.left ? rect.left - x : x > right ? x - right : 0;
      const dy = y < rect.top ? rect.top - y : y > bottom ? y - bottom : 0;
      // Prefer the same visual row over a horizontally close unit on another
      // row, while still resolving drags through whitespace between glyphs.
      const distance = dx * dx + dy * dy * 4;
      if (best && distance >= best.distance) continue;
      best = {
        endpoint: { pageNo, itemIndex, geometryIndex },
        distance,
      };
    }
  }
  return best && best.distance <= maxDistance * maxDistance ? best.endpoint : null;
}

export function standalonePdfSelectionDocumentEndpoints(
  pages: ReadonlyMap<number, StandalonePdfSelectionPage>,
): { anchor: StandalonePdfSelectionEndpoint; focus: StandalonePdfSelectionEndpoint } | null {
  const units = indexedUnits(pages);
  const anchor = units[0];
  const focus = units[units.length - 1];
  if (!anchor || !focus) return null;
  return {
    anchor: {
      pageNo: anchor.pageNo,
      itemIndex: anchor.itemIndex,
      geometryIndex: anchor.geometryIndex,
    },
    focus: {
      pageNo: focus.pageNo,
      itemIndex: focus.itemIndex,
      geometryIndex: focus.geometryIndex,
    },
  };
}

export function standalonePdfSelectionFragments(
  pages: ReadonlyMap<number, StandalonePdfSelectionPage>,
  anchor: StandalonePdfSelectionEndpoint,
  focus: StandalonePdfSelectionEndpoint,
): StandalonePdfSelectionFragment[] {
  const units = indexedUnits(pages);
  const anchorIndex = units.findIndex(unit => sameEndpoint(unit, anchor));
  const focusIndex = units.findIndex(unit => sameEndpoint(unit, focus));
  if (anchorIndex < 0 || focusIndex < 0) return [];

  const first = Math.min(anchorIndex, focusIndex);
  const last = Math.max(anchorIndex, focusIndex);
  const fragments: StandalonePdfSelectionFragment[] = [];
  for (const unit of units.slice(first, last + 1)) {
    const previous = fragments[fragments.length - 1];
    if (
      previous
      && previous.pageNo === unit.pageNo
      && previous.itemIndex === unit.itemIndex
      && unit.geometry.from <= previous.to
    ) {
      previous.to = Math.max(previous.to, unit.geometry.to);
      continue;
    }
    fragments.push({
      pageNo: unit.pageNo,
      itemIndex: unit.itemIndex,
      from: unit.geometry.from,
      to: unit.geometry.to,
    });
  }
  return fragments;
}

export function serializeStandalonePdfSelection(
  pages: ReadonlyMap<number, StandalonePdfSelectionPage>,
  anchor: StandalonePdfSelectionEndpoint,
  focus: StandalonePdfSelectionEndpoint,
): string | null {
  const fragments = standalonePdfSelectionFragments(pages, anchor, focus);
  if (fragments.length < 1) return null;

  const layout = standalonePdfTextLayout(pages);
  let result = "";
  let previousPage = fragments[0].pageNo;
  let previousItem: StandalonePdfSelectionItem | null = null;
  for (const fragment of fragments) {
    const item = pages.get(fragment.pageNo)?.textItems[fragment.itemIndex];
    if (!item) continue;
    const text = item.text.slice(fragment.from, fragment.to);
    if (previousItem && result) {
      const boundary = standalonePdfTextBoundary(
        previousPage,
        previousItem,
        fragment.pageNo,
        item,
        layout,
      );
      if (boundary === "paragraph") {
        result = result.trimEnd() + "\n";
      } else if (boundary === "line") {
        result += softLineSeparator(result, text);
      }
    }
    result += text;
    previousPage = fragment.pageNo;
    previousItem = item;
  }
  return result || null;
}

/**
 * Serializes the custom PDF selection as editable HTML plus the same logical
 * plain-text fallback used by ordinary Copy. The HTML contains only semantic
 * paragraphs and styled text runs; rendered page images are never copied.
 */
export function serializeStandalonePdfFormattedSelection(
  pages: ReadonlyMap<number, StandalonePdfSelectionPage>,
  anchor: StandalonePdfSelectionEndpoint,
  focus: StandalonePdfSelectionEndpoint,
): StandalonePdfFormattedSelection | null {
  const fragments = standalonePdfSelectionFragments(pages, anchor, focus);
  const plainText = serializeStandalonePdfSelection(pages, anchor, focus);
  if (fragments.length < 1 || plainText === null) return null;

  const layout = standalonePdfTextLayout(pages);
  const entries: FormattedSelectionEntry[] = [];
  let previousPage = fragments[0].pageNo;
  let previousItem: StandalonePdfSelectionItem | null = null;
  for (const fragment of fragments) {
    const item = pages.get(fragment.pageNo)?.textItems[fragment.itemIndex];
    if (!item) continue;
    let boundary: StandalonePdfTextBoundary = "same-line";
    if (previousItem) {
      boundary = standalonePdfTextBoundary(
        previousPage,
        previousItem,
        fragment.pageNo,
        item,
        layout,
      );
    }
    entries.push({
      item,
      boundary,
      html: styledHtmlFragments(item, fragment.from, fragment.to).join(""),
      text: item.text.slice(fragment.from, fragment.to),
    });
    previousPage = fragment.pageNo;
    previousItem = item;
  }

  const body = formattedSelectionHtml(entries);
  if (!body) return null;
  return {
    plainText,
    html: `<div style="white-space:normal">${body}</div>`,
  };
}

type FormattedSelectionEntry = {
  item: StandalonePdfSelectionItem;
  boundary: StandalonePdfTextBoundary;
  html: string;
  text: string;
};

function formattedSelectionHtml(entries: readonly FormattedSelectionEntry[]): string {
  const blocks: string[] = [];
  for (let index = 0; index < entries.length;) {
    const entry = entries[index];
    const tableId = entry.item.semanticTableId;
    if (tableId != null) {
      const end = consumeSemanticGroup(entries, index, item => item.semanticTableId === tableId);
      blocks.push(formattedTableHtml(entries.slice(index, end)));
      index = end;
      continue;
    }
    const figureId = entry.item.semanticFigureId;
    if (figureId != null) {
      const end = consumeSemanticGroup(entries, index, item => (
        item.semanticFigureId === figureId && item.semanticTableId == null
      ));
      const contents = formattedParagraphsHtml(entries.slice(index, end));
      blocks.push(
        `<table role="presentation" style="border:1px solid #808080;border-collapse:collapse;width:100%">`
        + `<tr><td style="border:1px solid #808080;padding:6pt">${contents}</td></tr></table>`,
      );
      index = end;
      continue;
    }
    const end = consumeSemanticGroup(entries, index, item => (
      item.semanticTableId == null && item.semanticFigureId == null
    ));
    blocks.push(formattedParagraphsHtml(entries.slice(index, end)));
    index = end;
  }
  return blocks.join("");
}

function consumeSemanticGroup(
  entries: readonly FormattedSelectionEntry[],
  start: number,
  matches: (item: StandalonePdfSelectionItem) => boolean,
): number {
  let end = start;
  while (end < entries.length && matches(entries[end].item)) end += 1;
  return end;
}

function formattedTableHtml(entries: readonly FormattedSelectionEntry[]): string {
  const captionEntries = entries.filter(entry => (
    entry.item.semanticRole === "Caption"
    && entry.item.semanticRowId == null
    && entry.item.semanticCellId == null
  ));
  const tableEntries = entries.filter(entry => !captionEntries.includes(entry));
  const rows: Array<{ id: number | null; cells: Array<{ id: number | null; role: string | null; entries: FormattedSelectionEntry[] }> }> = [];
  for (const entry of tableEntries) {
    const rowId = entry.item.semanticRowId ?? null;
    let row = rows[rows.length - 1];
    if (!row || row.id !== rowId) {
      row = { id: rowId, cells: [] };
      rows.push(row);
    }
    const cellId = entry.item.semanticCellId ?? null;
    let cell = row.cells[row.cells.length - 1];
    if (!cell || cell.id !== cellId) {
      cell = { id: cellId, role: entry.item.semanticRole ?? null, entries: [] };
      row.cells.push(cell);
    }
    cell.entries.push(entry);
  }
  const body = rows.map(row => {
    const cells = row.cells.map(cell => {
      const tag = cell.role === "TH" ? "th" : "td";
      return `<${tag} style="border:1px solid #808080;padding:4pt;vertical-align:top">`
        + `${formattedParagraphsHtml(cell.entries)}</${tag}>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  const caption = captionEntries.length > 0 ? formattedParagraphsHtml(captionEntries) : "";
  return `${caption}<table style="border-collapse:collapse;width:100%;margin:0 0 .75em 0">${body}</table>`;
}

function formattedParagraphsHtml(entries: readonly FormattedSelectionEntry[]): string {
  const paragraphs: Array<{ role: string | null; html: string[]; text: string }> = [];
  for (const entry of entries) {
    let paragraph = paragraphs[paragraphs.length - 1];
    if (!paragraph || entry.boundary === "paragraph") {
      paragraph = { role: entry.item.semanticRole ?? null, html: [], text: "" };
      paragraphs.push(paragraph);
    } else if (entry.boundary === "line") {
      const separator = softLineSeparator(paragraph.text, entry.text);
      if (separator) {
        paragraph.html.push(escapeHtml(separator));
        paragraph.text += separator;
      }
    }
    paragraph.html.push(entry.html);
    paragraph.text += entry.text;
  }
  return paragraphs
    .filter(paragraph => paragraph.html.length > 0)
    .map(paragraph => formattedParagraphHtml(paragraph.role, paragraph.html.join("")))
    .join("");
}

function formattedParagraphHtml(role: string | null, contents: string): string {
  if (/^H[1-6]$/u.test(role ?? "")) {
    const level = Number(role?.slice(1));
    return `<h${level} style="margin:.6em 0 .3em 0">${contents}</h${level}>`;
  }
  if (role === "H") return `<h2 style="margin:.6em 0 .3em 0">${contents}</h2>`;
  if (role === "Caption") {
    return `<p style="margin:.25em 0 .75em 0;text-align:center;font-style:italic">${contents}</p>`;
  }
  return `<p style="margin:0 0 .75em 0;white-space:pre-wrap">${contents}</p>`;
}

function styledHtmlFragments(item: StandalonePdfSelectionItem, from: number, to: number): string[] {
  const ranges = item.styleRanges ?? [];
  if (ranges.length < 1) return [escapeHtml(item.text.slice(from, to))];
  const segments: Array<{
    text: string;
    style: StandalonePdfSelectionStyleRange | null;
  }> = [];
  let offset = from;
  for (const range of ranges) {
    const start = Math.max(from, range.from);
    const end = Math.min(to, range.to);
    if (end <= start) continue;
    if (start > offset) segments.push({ text: item.text.slice(offset, start), style: null });
    segments.push({ text: item.text.slice(start, end), style: range });
    offset = end;
  }
  if (offset < to) segments.push({ text: item.text.slice(offset, to), style: null });

  // PDF font fallback commonly gives a painted space its own style range.
  // Word drops a whitespace-only inline element when importing clipboard
  // HTML. Move leading and isolated spaces into the preceding visible run so
  // the same ordinary, breakable characters remain part of actual text.
  const normalized: typeof segments = [];
  for (const segment of segments) {
    let text = segment.text;
    const leading = text.match(/^ +/u)?.[0] ?? "";
    if (leading && normalized.length > 0) {
      normalized[normalized.length - 1].text += leading;
      text = text.slice(leading.length);
    }
    if (!text) continue;
    normalized.push({ ...segment, text });
  }

  return normalized.map(segment => {
    const text = escapeHtml(segment.text);
    if (!segment.style) return text;
    const style = selectionCss(segment.style);
    const direction = segment.style.direction === "rtl" ? ' dir="rtl"' : "";
    return style || direction ? `<span${direction}${style ? ` style="${style}"` : ""}>${text}</span>` : text;
  });
}

function selectionCss(style: StandalonePdfSelectionStyleRange): string {
  const declarations: string[] = [];
  const family = normalizedFontFamily(style.fontFamily);
  if (family) declarations.push(`font-family:'${escapeCssString(family)}'`);
  if (style.fontSize != null && Number.isFinite(style.fontSize)) {
    declarations.push(`font-size:${Math.max(1, Math.min(200, style.fontSize)).toFixed(2)}pt`);
  }
  if (style.fontWeight != null && Number.isFinite(style.fontWeight)) {
    declarations.push(`font-weight:${Math.max(100, Math.min(900, Math.round(style.fontWeight / 100) * 100))}`);
  }
  if (style.italic) declarations.push("font-style:italic");
  if (/^#[0-9a-f]{6}$/iu.test(style.color ?? "")) declarations.push(`color:${style.color}`);
  return declarations.join(";");
}

function normalizedFontFamily(value: string | null | undefined): string {
  return (value ?? "").replace(/^[A-Z]{6}\+/u, "").trim();
}

function escapeCssString(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'").replace(/[\r\n]/gu, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

type StandalonePdfTextBoundary = "same-line" | "line" | "paragraph";

type StandalonePdfTextLayout = {
  lineStepByPage: ReadonlyMap<number, number>;
};

function standalonePdfTextLayout(
  pages: ReadonlyMap<number, StandalonePdfSelectionPage>,
): StandalonePdfTextLayout {
  const lineStepByPage = new Map<number, number>();
  for (const [pageNo, page] of pages) {
    const steps: number[] = [];
    let previousBaseline: number | null = null;
    for (const item of page.textItems) {
      if (item.baselineY == null) continue;
      if (previousBaseline != null) {
        const delta = Math.abs(item.baselineY - previousBaseline);
        const height = Math.max(1, item.height ?? 0);
        if (delta > height * 0.45) steps.push(delta);
      }
      previousBaseline = item.baselineY;
    }
    if (steps.length > 1) lineStepByPage.set(pageNo, median(steps));
  }
  return { lineStepByPage };
}

/**
 * PDF text extraction reports the end of every painted line. Those visual
 * wraps are not source newlines and must not leak into copied prose. A much
 * larger baseline gap is treated as a real paragraph boundary; page changes
 * are ordinary soft wraps because paragraphs commonly continue across pages.
 */
function standalonePdfTextBoundary(
  previousPage: number,
  previous: StandalonePdfSelectionItem,
  page: number,
  current: StandalonePdfSelectionItem,
  layout: StandalonePdfTextLayout,
): StandalonePdfTextBoundary {
  if (previous.semanticBlockId != null && current.semanticBlockId != null) {
    return previous.semanticBlockId === current.semanticBlockId ? "line" : "paragraph";
  }
  if (page !== previousPage) return "line";
  if (previous.baselineY == null || current.baselineY == null) {
    return previous.hasEOL ? "line" : "same-line";
  }

  const baselineDelta = Math.abs(current.baselineY - previous.baselineY);
  const lineHeight = Math.max(previous.height ?? 0, current.height ?? 0);
  if (lineHeight <= 0 || baselineDelta <= Math.max(1, lineHeight * 0.45)) return "same-line";
  const typicalLineStep = layout.lineStepByPage.get(page);
  const separatedByGap = typicalLineStep != null
    ? baselineDelta > typicalLineStep * 1.35
    : baselineDelta >= lineHeight * 1.75;
  if (separatedByGap || startsIndentedParagraph(previous, current, lineHeight)) return "paragraph";
  return "line";
}

function startsIndentedParagraph(
  previous: StandalonePdfSelectionItem,
  current: StandalonePdfSelectionItem,
  lineHeight: number,
): boolean {
  const previousLeft = itemLeft(previous);
  const currentLeft = itemLeft(current);
  if (previousLeft == null || currentLeft == null) return false;
  const previousText = previous.text.trimEnd();
  return currentLeft - previousLeft > Math.max(4, lineHeight * 0.65)
    && /[.!?។៕៖]["'”’»)]*$/u.test(previousText);
}

function itemLeft(item: StandalonePdfSelectionItem): number | null {
  const geometry = item.searchGeometry ?? [];
  return geometry.length > 0 ? Math.min(...geometry.map(rect => rect.left)) : null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function softLineSeparator(previous: string, current: string): string {
  if (!previous || !current || /\s$/u.test(previous) || /^\s/u.test(current)) return "";
  const previousCharacters = Array.from(previous);
  const left = previousCharacters[previousCharacters.length - 1] ?? "";
  const right = Array.from(current)[0] ?? "";
  if (isNoSpaceScript(left) && isNoSpaceScript(right)) return "";
  if (/[-\u00ad\u2010\u2011\u2012\u2013\u2014/([{]$/u.test(left)) return "";
  if (/^[,.;:!?%\u066a\u060c\u061b\u061f\u0964\u0965\u0e2f\u0e5a\u0e5b\u0eaf\u17d4-\u17da)\]}]/u.test(right)) return "";
  return " ";
}

function isNoSpaceScript(value: string): boolean {
  return /[\p{Script=Khmer}\p{Script=Thai}\p{Script=Lao}\p{Script=Myanmar}]/u.test(value);
}

function indexedUnits(pages: ReadonlyMap<number, StandalonePdfSelectionPage>): IndexedUnit[] {
  const units: IndexedUnit[] = [];
  const pageNumbers = [...pages.keys()].sort((left, right) => left - right);
  for (const pageNo of pageNumbers) {
    const items = pages.get(pageNo)?.textItems ?? [];
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const geometry = items[itemIndex].searchGeometry ?? [];
      for (let geometryIndex = 0; geometryIndex < geometry.length; geometryIndex += 1) {
        units.push({ pageNo, itemIndex, geometryIndex, geometry: geometry[geometryIndex] });
      }
    }
  }
  return units;
}

function sameEndpoint(left: StandalonePdfSelectionEndpoint, right: StandalonePdfSelectionEndpoint): boolean {
  return left.pageNo === right.pageNo
    && left.itemIndex === right.itemIndex
    && left.geometryIndex === right.geometryIndex;
}
