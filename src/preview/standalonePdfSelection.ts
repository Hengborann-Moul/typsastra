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
  searchGeometry?: StandalonePdfSelectionGeometry[];
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
