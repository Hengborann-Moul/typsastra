import { invoke } from "@tauri-apps/api/core";

export type PdfiumPageDimensions = {
  width: number;
  height: number;
};

type PdfiumDocumentInfo = {
  documentId: number;
  byteLength: number;
  pages: PdfiumPageDimensions[];
};

export type PdfiumTextChar = {
  text: string;
  left: number | null;
  bottom: number | null;
  right: number | null;
  top: number | null;
  fontSize: number;
};

export type PdfiumPageText = {
  width: number;
  height: number;
  chars: PdfiumTextChar[];
  semanticMarkers?: PdfiumSemanticMarker[];
};

export type PdfiumSemanticMarker = {
  blockId: number | null;
  x: number;
  y: number;
};

export type PdfiumTextRun = {
  text: string;
  left: number;
  bottom: number;
  right: number;
  top: number;
  hasEOL: boolean;
  dir: "ltr" | "rtl";
  glyphs: PdfiumTextGlyph[];
  semanticBlockId: number | null;
};

export type PdfiumTextGlyph = {
  from: number;
  to: number;
  left: number;
  bottom: number;
  right: number;
  top: number;
};

type PdfiumViewport = {
  width: number;
  height: number;
  scale: number;
  pageWidth: number;
  pageHeight: number;
};

type PdfiumRenderTask = {
  promise: Promise<void>;
  cancel(): void;
  imageCoordinates: null;
};

type PdfiumRenderOptions = {
  canvas: HTMLCanvasElement;
  viewport: PdfiumViewport;
};

export class PdfiumDocument {
  public readonly engine = "pdfium";
  public readonly numPages: number;
  public readonly byteLength: number;
  public readonly pageDimensions: readonly PdfiumPageDimensions[];
  private readonly pages = new Map<number, PdfiumPage>();
  private closed = false;

  private constructor(
    private readonly documentId: number,
    info: PdfiumDocumentInfo,
  ) {
    this.numPages = info.pages.length;
    this.byteLength = info.byteLength;
    this.pageDimensions = info.pages;
  }

  public static async open(path: string, deleteOnClose = false): Promise<PdfiumDocument> {
    const info = await invoke<PdfiumDocumentInfo>("open_pdfium_document", {
      path,
      deleteOnClose,
    });
    return new PdfiumDocument(info.documentId, info);
  }

  public async getPage(pageNo: number): Promise<PdfiumPage> {
    if (this.closed) throw new Error("The PDFium document is closed.");
    if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > this.numPages) {
      throw new Error(`PDF page ${pageNo} is outside the document.`);
    }
    let page = this.pages.get(pageNo);
    if (!page) {
      page = new PdfiumPage(this.documentId, pageNo, this.pageDimensions[pageNo - 1]);
      this.pages.set(pageNo, page);
    }
    return page;
  }

  public async cleanup(): Promise<void> {}

  public async destroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.pages.clear();
    await invoke("close_pdfium_document", { documentId: this.documentId }).catch(() => {});
  }
}

export class PdfiumPage {
  public readonly engine = "pdfium";
  public readonly imageCoordinates = null;
  private text: Promise<PdfiumPageText> | null = null;
  private textRuns: Promise<PdfiumTextRun[]> | null = null;

  public constructor(
    private readonly documentId: number,
    public readonly pageNumber: number,
    private readonly dimensions: PdfiumPageDimensions,
  ) {}

  public get height(): number {
    return this.dimensions.height;
  }

  public getViewport({ scale }: { scale: number }): PdfiumViewport {
    return {
      width: this.dimensions.width * scale,
      height: this.dimensions.height * scale,
      scale,
      pageWidth: this.dimensions.width,
      pageHeight: this.dimensions.height,
    };
  }

  public render({ canvas }: PdfiumRenderOptions): PdfiumRenderTask {
    let cancelled = false;
    const promise = (async () => {
      const response = await invoke<ArrayBuffer | Uint8Array | number[]>("render_pdfium_page", {
        documentId: this.documentId,
        pageNo: this.pageNumber,
        // PreviewFrame owns the backing-store calculation. Ask PDFium for
        // those exact dimensions so drawing the returned bitmap is a 1:1
        // copy rather than an additional browser resampling pass.
        width: Math.max(1, Math.min(65_535, canvas.width)),
        height: Math.max(1, Math.min(65_535, canvas.height)),
      });
      if (cancelled) throw renderingCancelled();
      const bytes = response instanceof Uint8Array
        ? response
        : response instanceof ArrayBuffer
          ? new Uint8Array(response)
          : new Uint8Array(response);
      const pngBytes = new Uint8Array(bytes.byteLength);
      pngBytes.set(bytes);
      const bitmap = await createImageBitmap(new Blob([pngBytes.buffer], { type: "image/png" }));
      try {
        if (cancelled) throw renderingCancelled();
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("The PDFium canvas is unavailable.");
        context.save();
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        context.restore();
      } finally {
        bitmap.close();
      }
    })();
    return {
      promise,
      cancel: () => { cancelled = true; },
      imageCoordinates: null,
    };
  }

  public getPdfiumText(): Promise<PdfiumPageText> {
    if (!this.text) {
      this.text = invoke<PdfiumPageText>("get_pdfium_page_text", {
        documentId: this.documentId,
        pageNo: this.pageNumber,
      });
    }
    return this.text;
  }

  public getPdfiumTextRuns(): Promise<PdfiumTextRun[]> {
    if (!this.textRuns) {
      this.textRuns = this.getPdfiumText().then(buildPdfiumTextRuns);
    }
    return this.textRuns;
  }

  public async getTextContent(): Promise<{ items: Array<Record<string, unknown>>; styles: Record<string, never> }> {
    const runs = await this.getPdfiumTextRuns();
    return {
      items: runs.map(run => ({
        str: run.text,
        dir: run.dir,
        width: Math.max(0, run.right - run.left),
        height: Math.max(0, run.top - run.bottom),
        transform: [1, 0, 0, 1, run.left, run.bottom],
        hasEOL: run.hasEOL,
        fontName: "pdfium",
      })),
      styles: {},
    };
  }

  public cleanup(): void {}
}

export function isPdfiumDocument(value: unknown): value is PdfiumDocument {
  return (value as { engine?: unknown } | null)?.engine === "pdfium";
}

export function isPdfiumPage(value: unknown): value is PdfiumPage {
  return (value as { engine?: unknown } | null)?.engine === "pdfium";
}

function renderingCancelled(): Error {
  const error = new Error("PDFium rendering was cancelled.");
  error.name = "RenderingCancelledException";
  return error;
}

export function buildPdfiumTextRuns(page: PdfiumPageText): PdfiumTextRun[] {
  const lines: Array<{ chars: PdfiumTextChar[]; hasEOL: boolean }> = [];
  let chars: PdfiumTextChar[] = [];
  let baseline: number | null = null;
  let lineHeight = 0;

  const flush = (hasEOL: boolean) => {
    if (chars.length > 0) lines.push({ chars, hasEOL });
    chars = [];
    baseline = null;
    lineHeight = 0;
  };

  for (const char of page.chars) {
    if (char.text === "\r") continue;
    if (char.text === "\n") {
      flush(true);
      continue;
    }
    const charHeight = char.bottom !== null && char.top !== null
      ? Math.abs(char.top - char.bottom)
      : Math.abs(char.fontSize);
    const charBaseline = char.bottom;
    if (
      chars.length > 0
      && baseline !== null
      && charBaseline !== null
      && Math.abs(charBaseline - baseline) > Math.max(1, Math.max(lineHeight, charHeight) * 0.45)
    ) {
      flush(true);
    }
    chars.push(char);
    if (charBaseline !== null) baseline = baseline === null ? charBaseline : baseline;
    lineHeight = Math.max(lineHeight, charHeight);
  }
  flush(false);

  const runs = lines.flatMap(line => {
    const positioned = line.chars.filter(char => (
      char.left !== null && char.bottom !== null && char.right !== null && char.top !== null
    ));
    if (positioned.length < 1) return [];
    const ordered = orderPdfiumLineChars(line.chars);
    let text = "";
    const characterGlyphs: PdfiumTextGlyph[] = [];
    for (const char of ordered) {
      const from = text.length;
      text += char.text;
      const to = text.length;
      if (char.left !== null && char.bottom !== null && char.right !== null && char.top !== null) {
        characterGlyphs.push({
          from,
          to,
          left: char.left,
          bottom: char.bottom,
          right: char.right,
          top: char.top,
        });
      }
    }
    return [{
      text,
      left: Math.min(...positioned.map(char => Number(char.left))),
      bottom: Math.min(...positioned.map(char => Number(char.bottom))),
      right: Math.max(...positioned.map(char => Number(char.right))),
      top: Math.max(...positioned.map(char => Number(char.top))),
      hasEOL: line.hasEOL,
      dir: firstStrongDirection(text),
      glyphs: groupPdfiumGlyphsByGrapheme(text, characterGlyphs),
      semanticBlockId: null,
    }];
  });
  assignPdfiumSemanticBlocks(runs, page.semanticMarkers ?? []);
  return runs;
}

/**
 * Tagged PDFs identify logical blocks with marked-content anchors. The
 * anchor's translation is in the same bottom-up page coordinate system as
 * PDFium's character boxes, so each visual line inherits the most recent
 * marker above its baseline. Artifact markers intentionally clear the block
 * for running headers and footers.
 */
function assignPdfiumSemanticBlocks(
  runs: PdfiumTextRun[],
  markers: readonly PdfiumSemanticMarker[],
): void {
  if (runs.length < 1 || markers.length < 1) return;
  const ordered = [...markers]
    .filter(marker => Number.isFinite(marker.y))
    .sort((left, right) => right.y - left.y);
  let markerIndex = 0;
  let activeBlock: number | null = null;
  for (const run of runs) {
    const tolerance = Math.max(1, (run.top - run.bottom) * 0.35);
    while (markerIndex < ordered.length && ordered[markerIndex].y >= run.bottom - tolerance) {
      activeBlock = ordered[markerIndex].blockId;
      markerIndex += 1;
    }
    run.semanticBlockId = activeBlock;
  }
}

/**
 * PDFium exposes character boxes, but a visible Unicode grapheme may contain
 * several of those characters (for example a Khmer base, coeng sequence, and
 * dependent vowel). Selection endpoints must use the grapheme as their
 * indivisible unit. Otherwise overlapping character bounds can paint the
 * entire grapheme while clipboard serialization silently omits its last mark.
 */
export function groupPdfiumGlyphsByGrapheme(
  text: string,
  glyphs: readonly PdfiumTextGlyph[],
): PdfiumTextGlyph[] {
  if (!text || glyphs.length < 1) return [];
  const boundaries = graphemeBoundaries(text);
  const grouped: PdfiumTextGlyph[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const from = boundaries[index];
    const to = boundaries[index + 1];
    const members = glyphs.filter(glyph => glyph.to > from && glyph.from < to);
    if (members.length < 1) continue;
    grouped.push({
      from,
      to,
      left: Math.min(...members.map(glyph => glyph.left)),
      bottom: Math.min(...members.map(glyph => glyph.bottom)),
      right: Math.max(...members.map(glyph => glyph.right)),
      top: Math.max(...members.map(glyph => glyph.top)),
    });
  }
  return grouped;
}

function graphemeBoundaries(text: string): number[] {
  type SegmentRecord = { index: number };
  type SegmenterLike = { segment(input: string): Iterable<SegmentRecord> };
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (
      locale: string | undefined,
      options: { granularity: "grapheme" },
    ) => SegmenterLike;
  }).Segmenter;
  if (Segmenter) {
    const segmenter = new Segmenter(undefined, { granularity: "grapheme" });
    const starts = [...segmenter.segment(text)].map(segment => segment.index);
    return [...starts, text.length];
  }
  const boundaries = [0];
  let offset = 0;
  for (const codePoint of text) {
    offset += codePoint.length;
    boundaries.push(offset);
  }
  return boundaries;
}

function firstStrongDirection(text: string): "ltr" | "rtl" {
  for (const char of text) {
    if (/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(char)) return "rtl";
    if (/\p{Letter}|\p{Number}/u.test(char)) return "ltr";
  }
  return "ltr";
}

function orderPdfiumLineChars(chars: PdfiumTextChar[]): PdfiumTextChar[] {
  if (!chars.some(char => strongDirection(char.text) === "rtl")) return chars;

  // PDFium normally exposes the enhanced engine's characters in logical
  // order, even though an RTL run's geometry moves from right to left. Keep
  // that order intact. Older PDFs can instead expose a visually ordered RTL
  // run, whose character boxes move left to right; reverse only that run.
  // Sorting the whole line by X corrupts mixed-script text and can place an
  // Arabic punctuation character after the visually final LTR character,
  // making a whole-line drag omit it from the clipboard.
  const result = [...chars];
  let start = 0;
  while (start < result.length) {
    if (strongDirection(result[start].text) !== "rtl") {
      start += 1;
      continue;
    }

    let boundary = start + 1;
    let lastRtl = start;
    while (boundary < result.length && strongDirection(result[boundary].text) !== "ltr") {
      if (strongDirection(result[boundary].text) === "rtl") lastRtl = boundary;
      boundary += 1;
    }

    const positionedRtl = result.slice(start, lastRtl + 1).filter(char => (
      strongDirection(char.text) === "rtl" && char.left !== null
    ));
    const firstLeft = positionedRtl[0]?.left;
    const lastLeft = positionedRtl[positionedRtl.length - 1]?.left;
    if (
      firstLeft !== null
      && firstLeft !== undefined
      && lastLeft !== null
      && lastLeft !== undefined
      && firstLeft < lastLeft
    ) {
      result.splice(
        start,
        lastRtl - start + 1,
        ...result.slice(start, lastRtl + 1).reverse(),
      );
    }
    start = boundary;
  }
  return result;
}

function strongDirection(text: string): "ltr" | "rtl" | "neutral" {
  if (/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(text)) return "rtl";
  if (/\p{Letter}|\p{Number}/u.test(text)) return "ltr";
  return "neutral";
}
