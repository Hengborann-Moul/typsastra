import { describe, expect, test } from "bun:test";
import {
  buildPdfiumTextRuns,
  classifyStandalonePdfLoadFailure,
  groupPdfiumGlyphsByGrapheme,
  PdfiumPage,
  type PdfiumPageText,
} from "../src/preview/pdfiumDocument";

function page(chars: PdfiumPageText["chars"]): PdfiumPageText {
  return { width: 200, height: 200, chars };
}

function char(text: string, left: number, bottom: number, right: number, top: number) {
  return { text, left, bottom, right, top, fontSize: top - bottom };
}

describe("standalone PDF load failures", () => {
  test("presents clear messages for known bad PDF categories", () => {
    expect(classifyStandalonePdfLoadFailure("TYPSASTRA_PDF_OPEN_PASSWORD")).toEqual({
      title: "Password-protected PDF",
      message: "Typsastra cannot open a PDF that requires a password.",
    });
    expect(classifyStandalonePdfLoadFailure("TYPSASTRA_PDF_OPEN_MALFORMED").title)
      .toBe("Damaged or invalid PDF");
    expect(classifyStandalonePdfLoadFailure("TYPSASTRA_PDF_OPEN_EMPTY").title)
      .toBe("Empty PDF");
    expect(classifyStandalonePdfLoadFailure("TYPSASTRA_PDF_OPEN_UNSUPPORTED").title)
      .toBe("Unsupported PDF");
  });

  test("preserves unexpected loader details for diagnosis", () => {
    expect(classifyStandalonePdfLoadFailure("backend unavailable")).toEqual({
      title: "PDF loading failed",
      message: "backend unavailable",
    });
  });
});

describe("PDFium standalone text runs", () => {
  test("exposes standalone links in PDF coordinates", async () => {
    const page = new PdfiumPage(7, 2, { width: 200, height: 300 }, [
      {
        rect: [10, 220, 80, 240],
        url: null,
        destination: { pageNo: 5, x: 14, y: 32 },
      },
      {
        rect: [90, 220, 150, 240],
        url: "https://typst.app",
        destination: null,
      },
    ]);

    expect(page.getViewport({ scale: 2 }).convertToViewportPoint(10, 240)).toEqual([20, 120]);
    expect(await page.getAnnotations()).toEqual([
      {
        subtype: "Link",
        rect: [10, 220, 80, 240],
        url: undefined,
        typsastraDestination: { pageNo: 5, x: 14, y: 32 },
      },
      {
        subtype: "Link",
        rect: [90, 220, 150, 240],
        url: "https://typst.app",
        typsastraDestination: undefined,
      },
    ]);
  });

  test("combines positioned characters into selectable visual lines", () => {
    const runs = buildPdfiumTextRuns(page([
      char("H", 10, 150, 18, 162),
      char("i", 18, 150, 22, 162),
      char(" ", 22, 150, 26, 162),
      char("ក", 26, 150, 36, 162),
      { text: "\n", left: null, bottom: null, right: null, top: null, fontSize: 0 },
      char("N", 10, 130, 18, 142),
    ]));

    expect(runs.map(run => run.text)).toEqual(["Hi ក", "N"]);
    expect(runs.map(run => run.hasEOL)).toEqual([true, false]);
    expect(runs[0]).toMatchObject({ left: 10, right: 36, bottom: 150, top: 162 });
    expect(runs[0].glyphs).toEqual([
      { from: 0, to: 1, left: 10, bottom: 150, right: 18, top: 162 },
      { from: 1, to: 2, left: 18, bottom: 150, right: 22, top: 162 },
      { from: 2, to: 3, left: 22, bottom: 150, right: 26, top: 162 },
      { from: 3, to: 4, left: 26, bottom: 150, right: 36, top: 162 },
    ]);
  });

  test("restores logical order within a visually positioned RTL run", () => {
    const runs = buildPdfiumTextRuns(page([
      char("A", 10, 150, 18, 162),
      char(":", 18, 150, 22, 162),
      char("ب", 50, 150, 58, 162),
      char("ا", 58, 150, 66, 162),
    ]));

    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe("A:اب");
    expect(runs[0].dir).toBe("ltr");
  });

  test("restores a Latin label before visually positioned Arabic", () => {
    const visual = [
      ...[..."EU-ARABIC-01: "].map((text, index) => char(text, 10 + index * 6, 150, 16 + index * 6, 162)),
      char("ت", 136, 150, 142, 162),
      char("ب", 142, 150, 148, 162),
      char("ا", 148, 150, 154, 162),
      char(".", 130, 150, 136, 162),
    ];

    const runs = buildPdfiumTextRuns(page(visual));

    expect(runs[0].text).toBe("EU-ARABIC-01: ابت.");
    expect(runs[0].dir).toBe("ltr");
  });

  test("preserves enhanced logical RTL order inside mixed-script lines", () => {
    const runs = buildPdfiumTextRuns(page([
      ...[..."EU-MIXED: "].map((text, index) => char(text, 10 + index * 6, 150, 16 + index * 6, 162)),
      char("ا", 154, 150, 160, 162),
      char("ب", 148, 150, 154, 162),
      char(".", 142, 150, 148, 162),
      char("X", 166, 150, 172, 162),
    ]));

    expect(runs[0].text).toBe("EU-MIXED: اب.X");
  });

  test("does not reorder Arabic punctuation in an otherwise LTR line", () => {
    const text = "EU-PUNCT: ១០០٪.";
    const runs = buildPdfiumTextRuns(page(
      [...text].map((value, index) => char(value, 10 + index * 6, 150, 16 + index * 6, 162)),
    ));

    expect(runs[0].text).toBe(text);
    expect(runs[0].glyphs.map(glyph => text.slice(glyph.from, glyph.to)).join(""))
      .toBe(text);
  });

  test("merges PDFium character boxes into indivisible Khmer graphemes", () => {
    const text = "កម្ពុជា";
    const glyphs = [...text].map((value, index) => {
      const from = [...text].slice(0, index).join("").length;
      return {
        from,
        to: from + value.length,
        left: index * 5,
        bottom: 10,
        right: index * 5 + 7,
        top: 22,
      };
    });

    const grouped = groupPdfiumGlyphsByGrapheme(text, glyphs);

    expect(grouped.map(glyph => text.slice(glyph.from, glyph.to)).join("")).toBe(text);
    expect(grouped.length).toBeLessThan([...text].length);
    expect(grouped.at(-1)?.to).toBe(text.length);
    expect(grouped.some(glyph => glyph.to - glyph.from > 1)).toBe(true);
  });

  test("assigns tagged semantic blocks from page-coordinate markers", () => {
    const fixture = page([
      char("A", 10, 150, 18, 162),
      { text: "\n", left: null, bottom: null, right: null, top: null, fontSize: 0 },
      char("B", 10, 130, 18, 142),
    ]);
    fixture.semanticMarkers = [
      { blockId: 4, x: 10, y: 156 },
    ];

    expect(buildPdfiumTextRuns(fixture).map(run => run.semanticBlockId)).toEqual([4, 4]);
  });

  test("changes tagged blocks at authored boundaries and clears page artifacts", () => {
    const fixture = page([
      char("A", 10, 150, 18, 162),
      { text: "\n", left: null, bottom: null, right: null, top: null, fontSize: 0 },
      char("B", 10, 130, 18, 142),
    ]);
    fixture.semanticMarkers = [
      { blockId: null, x: 10, y: 180 },
      { blockId: 4, x: 10, y: 156 },
      { blockId: 5, x: 10, y: 136 },
    ];

    expect(buildPdfiumTextRuns(fixture).map(run => run.semanticBlockId)).toEqual([4, 5]);
  });

  test("splits one painted baseline into tagged table cells", () => {
    const fixture = page([
      char("A", 10, 150, 18, 162),
      char("1", 18, 150, 24, 162),
      char("B", 110, 150, 118, 162),
      char("2", 118, 150, 124, 162),
    ]);
    fixture.semanticMarkers = [
      {
        blockId: 10,
        role: "TH",
        tableId: 2,
        rowId: 3,
        cellId: 4,
        figureId: null,
        x: 10,
        y: 156,
      },
      {
        blockId: 11,
        role: "TH",
        tableId: 2,
        rowId: 3,
        cellId: 5,
        figureId: null,
        x: 110,
        y: 156,
      },
    ];

    const runs = buildPdfiumTextRuns(fixture);

    expect(runs.map(run => run.text)).toEqual(["A1", "B2"]);
    expect(runs.map(run => run.semanticCellId)).toEqual([4, 5]);
    expect(runs.map(run => run.semanticRole)).toEqual(["TH", "TH"]);
    expect(runs.map(run => run.hasEOL)).toEqual([false, false]);
  });
});
