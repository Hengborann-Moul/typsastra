export interface PdfTextItemGeometry {
  pageNo: number;
  str: string;
  width: number;
  height: number;
  transform: number[];
  pageView: number[];
}

export interface UnicodeFixtureCase {
  id: string;
  expected: string;
}

export interface UnicodeCaseResult {
  id: string;
  exactLogicalText: boolean;
  whitespaceInsensitiveText: boolean;
  markerFound: boolean;
  geometryFinite: boolean;
  geometryInsidePage: boolean;
  textItemCount: number;
  unexpectedControlCharacters: string[];
  extracted: string;
}

const fixtureCasePattern = /^(EU-[A-Z]+-\d+):\s*(.+)$/u;

export function parseUnicodeFixtureCases(source: string): UnicodeFixtureCase[] {
  return source
    .split(/\r?\n/u)
    .map(line => line.trim())
    .map(line => {
      const match = fixtureCasePattern.exec(line);
      return match ? { id: match[1], expected: line } : null;
    })
    .filter((value): value is UnicodeFixtureCase => value !== null);
}

export function compactWhitespace(value: string): string {
  return value.replace(/\s+/gu, "");
}

function unexpectedControls(value: string): string[] {
  return [...new Set(
    Array.from(value)
      .filter(character => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(character))
      .map(character => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`)
  )];
}

function geometryIsFinite(item: PdfTextItemGeometry): boolean {
  return [item.width, item.height, ...item.transform, ...item.pageView].every(Number.isFinite);
}

function geometryIsInsidePage(item: PdfTextItemGeometry): boolean {
  if (!geometryIsFinite(item) || item.transform.length < 6 || item.pageView.length < 4) return false;
  const [viewX1, viewY1, viewX2, viewY2] = item.pageView;
  const x = item.transform[4];
  const baselineY = item.transform[5];
  const left = Math.min(x, x + item.width);
  const right = Math.max(x, x + item.width);
  const top = baselineY - Math.abs(item.height);
  const bottom = baselineY + Math.abs(item.height) * 0.35;
  const tolerance = 2;
  return left >= viewX1 - tolerance
    && right <= viewX2 + tolerance
    && top >= viewY1 - tolerance
    && bottom <= viewY2 + tolerance;
}

export function analyzeUnicodeTextItems(
  cases: UnicodeFixtureCase[],
  items: PdfTextItemGeometry[]
): UnicodeCaseResult[] {
  const fullText = items.map(item => item.str).join("");
  const offsets: Array<{ from: number; to: number; item: PdfTextItemGeometry }> = [];
  let cursor = 0;
  for (const item of items) {
    offsets.push({ from: cursor, to: cursor + item.str.length, item });
    cursor += item.str.length;
  }

  return cases.map((fixtureCase, index) => {
    const markerStart = fullText.indexOf(`${fixtureCase.id}:`);
    const nextMarker = cases[index + 1]?.id;
    const markerEnd = nextMarker && markerStart >= 0
      ? fullText.indexOf(`${nextMarker}:`, markerStart + fixtureCase.id.length)
      : fullText.length;
    const safeEnd = markerEnd >= markerStart ? markerEnd : fullText.length;
    const extracted = markerStart >= 0 ? fullText.slice(markerStart, safeEnd).trim() : "";
    const matchingItems = markerStart < 0
      ? []
      : offsets
          .filter(entry => entry.to > markerStart && entry.from < safeEnd)
          .map(entry => entry.item);

    return {
      id: fixtureCase.id,
      exactLogicalText: extracted === fixtureCase.expected,
      whitespaceInsensitiveText:
        compactWhitespace(extracted) === compactWhitespace(fixtureCase.expected),
      markerFound: markerStart >= 0,
      geometryFinite: matchingItems.length > 0 && matchingItems.every(geometryIsFinite),
      geometryInsidePage: matchingItems.length > 0 && matchingItems.every(geometryIsInsidePage),
      textItemCount: matchingItems.length,
      unexpectedControlCharacters: unexpectedControls(extracted),
      extracted
    };
  });
}

