import { describe, expect, test } from "bun:test";
import { buildPdfiumTextRuns, type PdfiumPageText } from "../src/preview/pdfiumDocument";

function page(chars: PdfiumPageText["chars"]): PdfiumPageText {
  return { width: 200, height: 200, chars };
}

function char(text: string, left: number, bottom: number, right: number, top: number) {
  return { text, left, bottom, right, top, fontSize: top - bottom };
}

describe("PDFium standalone text runs", () => {
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
});
