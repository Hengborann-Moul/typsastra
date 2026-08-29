import { describe, expect, test } from "bun:test";
import {
  capturePreviewDocumentToken,
  previewDocumentTokenIsCurrent,
} from "../src/preview/previewDocumentGeneration";

describe("standalone PDF document replacement", () => {
  test("rejects asynchronous work owned by an older document generation", () => {
    const olderDocument = { name: "older" };
    const newerDocument = { name: "newer" };
    const olderWork = capturePreviewDocumentToken(4, olderDocument);
    const newerWork = capturePreviewDocumentToken(5, newerDocument);

    expect(previewDocumentTokenIsCurrent(olderWork, 5, newerDocument)).toBe(false);
    expect(previewDocumentTokenIsCurrent(olderWork, 4, newerDocument)).toBe(false);
    expect(previewDocumentTokenIsCurrent(newerWork, 5, newerDocument)).toBe(true);
  });

  test("clears the old PDF surface before opening and rebuilds page slots", async () => {
    const source = await Bun.file(new URL("../src/preview/previewFrame.ts", import.meta.url)).text();
    const generation = source.indexOf("const generation = ++this.pdfGeneration;");
    const reset = source.indexOf("this.resetStandalonePdfSearch();", generation);
    const prepareSurface = source.indexOf("this.preparePdfReplacementSurface(existingIframeDoc);", generation);
    const ensureIframe = source.indexOf("const iframe = await this.ensureIframe();", generation);
    const openDocument = source.indexOf("PdfiumDocument.open(", ensureIframe);

    expect(generation).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(generation);
    expect(reset).toBeLessThan(prepareSurface);
    expect(prepareSurface).toBeLessThan(ensureIframe);
    expect(ensureIframe).toBeLessThan(openDocument);
    expect(source).toContain("this.createPageSlots(iframeDoc, false);");
    expect(source).not.toContain("this.createPageSlots(iframeDoc, true);");
    expect(source).toContain('replaceElementChildren(viewer);');
    expect(source).toContain('this.mountedSessionKey = "";');
    expect(source).toContain('root.dataset.pdfReplacing !== "true"');
  });

  test("detaches the previous document when a replacement fails", async () => {
    const source = await Bun.file(new URL("../src/preview/previewFrame.ts", import.meta.url)).text();
    const failure = source.indexOf("} catch (error) {", source.indexOf("private async loadPdfSource("));
    const finallyBlock = source.indexOf("} finally {", failure);
    const failureBody = source.slice(failure, finallyBlock);

    expect(failureBody).toContain("this.pdfDoc = null;");
    expect(failureBody).toContain("this.pdfLoadingTask = null;");
    expect(failureBody).toContain("this.pageDimensions.clear();");
    expect(failureBody).toContain("classifyStandalonePdfLoadFailure(error)");
    expect(source).toContain("if (!doc || !this.pdfDoc || !this.isStandalonePdfSurface()) return;");
  });

  test("binds search to one immutable PDF document across every await", async () => {
    const source = await Bun.file(new URL("../src/preview/previewFrame.ts", import.meta.url)).text();

    expect(source).toContain("const documentToken = capturePreviewDocumentToken(this.pdfGeneration, pdfDoc);");
    expect(source).toContain("previewDocumentTokenIsCurrent(documentToken, this.pdfGeneration, this.pdfDoc)");
    expect(source.match(/if \(!isCurrent\(\)\) return;/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
