export type PdfTextItem = {
  str: string;
  dir?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
  [key: string]: unknown;
};

type PdfTextContent = {
  items?: unknown[];
  [key: string]: unknown;
};

const RTL_SCRIPT = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;

function isTextItem(value: unknown): value is PdfTextItem {
  return typeof (value as PdfTextItem | undefined)?.str === "string";
}

function isRtlItem(item: PdfTextItem): boolean {
  return item.dir === "rtl" || RTL_SCRIPT.test(item.str);
}

function isWhitespaceItem(item: PdfTextItem): boolean {
  return item.str.length > 0 && /^\s+$/u.test(item.str);
}

function baseline(item: PdfTextItem): number | null {
  const value = Number(item.transform?.[5]);
  return Number.isFinite(value) ? value : null;
}

function sameVisualLine(left: PdfTextItem, right: PdfTextItem): boolean {
  const leftY = baseline(left);
  const rightY = baseline(right);
  if (leftY === null || rightY === null) return true;
  const tolerance = Math.max(0.5, Math.abs(Number(left.height) || 0) * 0.35);
  return Math.abs(leftY - rightY) <= tolerance;
}

function horizontalPosition(item: PdfTextItem): number {
  const value = Number(item.transform?.[4]);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

/**
 * PDF logical units are emitted in source order inside each shaped RTL word,
 * but PDF.js encounters the positioned words in visual left-to-right order.
 * Reversing the geometry order of the complete RTL run restores source order
 * without changing the painted coordinates.
 */
export function reorderPdfLogicalTextItems(items: unknown[]): unknown[] {
  const ordered = [...items];
  let index = 0;
  while (index < ordered.length) {
    const first = ordered[index];
    if (!isTextItem(first) || !isRtlItem(first)) {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < ordered.length) {
      const candidate = ordered[end];
      if (!isTextItem(candidate) || !sameVisualLine(first, candidate)) break;
      if (isRtlItem(candidate)) {
        end += 1;
        continue;
      }
      if (isWhitespaceItem(candidate)) {
        let next = end + 1;
        while (next < ordered.length) {
          const nextItem = ordered[next];
          if (!isTextItem(nextItem) || !sameVisualLine(first, nextItem)) break;
          if (!isWhitespaceItem(nextItem)) break;
          next += 1;
        }
        if (
          next < ordered.length
          && isTextItem(ordered[next])
          && sameVisualLine(first, ordered[next] as PdfTextItem)
          && isRtlItem(ordered[next] as PdfTextItem)
        ) {
          end = next;
          continue;
        }
      }
      break;
    }

    if (end - index > 1) {
      const reordered = ordered
        .slice(index, end)
        .map((item, originalIndex) => ({ item, originalIndex }))
        .sort((left, right) => {
          const positionDelta = horizontalPosition(right.item as PdfTextItem)
            - horizontalPosition(left.item as PdfTextItem);
          return positionDelta || left.originalIndex - right.originalIndex;
        })
        .map(entry => entry.item);
      ordered.splice(index, end - index, ...reordered);
    }
    index = end;
  }
  return ordered;
}

export function normalizePdfLogicalTextContent<T extends PdfTextContent>(content: T): T {
  if (!Array.isArray(content.items)) return content;
  return { ...content, items: reorderPdfLogicalTextItems(content.items) };
}

export type PdfTextSearchFragment = {
  itemIndex: number;
  from: number;
  to: number;
};

export function findPdfTextMatches(
  items: unknown[],
  rawQuery: string,
): PdfTextSearchFragment[][] {
  const query = rawQuery.toLocaleLowerCase();
  if (!query) return [];
  const searchableItems: Array<{ itemIndex: number; from: number; to: number }> = [];
  let pageText = "";
  for (const value of items) {
    if (!isTextItem(value)) continue;
    const from = pageText.length;
    pageText += value.str;
    searchableItems.push({ itemIndex: searchableItems.length, from, to: pageText.length });
  }

  const matches: PdfTextSearchFragment[][] = [];
  const comparable = pageText.toLocaleLowerCase();
  let from = comparable.indexOf(query);
  while (from >= 0) {
    const to = from + query.length;
    const fragments = searchableItems
      .filter(item => item.to > from && item.from < to)
      .map(item => ({
        itemIndex: item.itemIndex,
        from: Math.max(0, from - item.from),
        to: Math.min(item.to - item.from, to - item.from),
      }));
    if (fragments.length > 0) matches.push(fragments);
    from = comparable.indexOf(query, from + Math.max(1, query.length));
  }
  return matches;
}
