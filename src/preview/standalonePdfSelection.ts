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

  let result = "";
  let previousPage = fragments[0].pageNo;
  let previousItem: StandalonePdfSelectionItem | null = null;
  for (const fragment of fragments) {
    const item = pages.get(fragment.pageNo)?.textItems[fragment.itemIndex];
    if (!item) continue;
    const changedPage = fragment.pageNo !== previousPage;
    const baselineDelta = previousItem?.baselineY != null && item.baselineY != null
      ? Math.abs(item.baselineY - previousItem.baselineY)
      : 0;
    const lineThreshold = Math.max(
      1,
      Math.min(
        previousItem?.height ?? Number.POSITIVE_INFINITY,
        item.height ?? Number.POSITIVE_INFINITY,
      ) * 0.45,
    );
    const changedVisualLine = !changedPage
      && baselineDelta > lineThreshold
      && Number.isFinite(lineThreshold);
    if ((changedPage || changedVisualLine) && result && !result.endsWith("\n")) result += "\n";
    result += item.text.slice(fragment.from, fragment.to);
    if (item.hasEOL && fragment.to >= item.text.length && !result.endsWith("\n")) result += "\n";
    previousPage = fragment.pageNo;
    previousItem = item;
  }
  return result || null;
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
