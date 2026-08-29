import { describe, expect, test } from "bun:test";
import { isPdfExportCancellation } from "../src/export/projectExportController";

describe("PDF export cancellation", () => {
  test("distinguishes native and local cancellation from export failures", () => {
    expect(isPdfExportCancellation(new Error("PDF_EXPORT_CANCELLED"))).toBe(true);
    expect(isPdfExportCancellation("PDF_EXPORT_CANCELLED")).toBe(true);
    expect(isPdfExportCancellation(new Error("compiler failed"))).toBe(false);
  });

  test("initializes cancellation before compilation and gates transactional commit", async () => {
    const source = await Bun.file(new URL(
      "../src/export/projectExportController.ts",
      import.meta.url,
    )).text();
    const begin = source.indexOf('invoke("begin_pdf_export_operation", { operationId })');
    const compile = source.indexOf('invoke<string>("compile_typst_document"');
    const cancellationGate = source.indexOf("this.throwIfPdfExportCancelled();", compile);
    const commit = source.indexOf('invoke("commit_pdf_export", { operationId', compile);

    expect(begin).toBeGreaterThan(-1);
    expect(begin).toBeLessThan(compile);
    expect(cancellationGate).toBeGreaterThan(compile);
    expect(cancellationGate).toBeLessThan(commit);
    expect(source).toContain('invoke("cancel_pdf_export", { operationId })');
    expect(source).toContain('invoke("finish_pdf_export_operation", { operationId })');
    expect(source).toContain("Use Export PDF again to cancel.");
    expect(source).toContain('message: "Finalizing PDF export..."');
  });

  test("turns the active export action into an explicit cancel action", async () => {
    const source = await Bun.file(new URL(
      "../src/export/projectExportController.ts",
      import.meta.url,
    )).text();

    expect(source).toContain('const label = running ? "Cancel PDF Export" : "Export PDF";');
    expect(source).toContain("if (this.activePdfOperationId)");
    expect(source).toContain("await this.cancelPdfExport();");
    expect(source).toContain('button.classList.toggle("is-cancelling-action", running);');
  });
});
