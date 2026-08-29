import { describe, expect, test } from "bun:test";
import {
  isPdfExportCancellation,
  pdfExportProvenanceLog,
  type PdfExportProvenance,
} from "../src/export/projectExportController";

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
    const inspect = source.indexOf('invoke<PdfExportProvenance>("inspect_pdf_export_compiler"');
    const compile = source.indexOf('invoke<string>("compile_typst_document"');
    const cancellationGate = source.indexOf("this.throwIfPdfExportCancelled();", compile);
    const commit = source.indexOf('invoke("commit_pdf_export", { operationId', compile);

    expect(begin).toBeGreaterThan(-1);
    expect(begin).toBeLessThan(inspect);
    expect(inspect).toBeLessThan(compile);
    expect(cancellationGate).toBeGreaterThan(compile);
    expect(cancellationGate).toBeLessThan(commit);
    expect(source).toContain('invoke("cancel_pdf_export", { operationId })');
    expect(source).toContain('invoke("finish_pdf_export_operation", { operationId })');
    expect(source).toContain("Use Export PDF again to cancel.");
    expect(source).toContain("Finalizing PDF export with ${provenance.displayName}...");
    expect(source.slice(compile, cancellationGate)).not.toContain("compilerPath");
  });

  test("records compiler identity without exposing executable or destination paths", () => {
    const cases: PdfExportProvenance[] = [
      {
        compilerKind: "enhanced-managed",
        displayName: "Enhanced Unicode Engine v0.4.0",
        compilerVersion: "0.15.1",
        typstVersion: "0.15.1",
        engineVersion: "0.4.0",
      },
      {
        compilerKind: "custom-typst",
        displayName: "Custom Typst 0.15.1",
        compilerVersion: "0.15.1",
        typstVersion: "0.15.1",
      },
      {
        compilerKind: "tinymist",
        displayName: "Tinymist 0.13.0 (Typst 0.15.1)",
        compilerVersion: "0.13.0",
        typstVersion: "0.15.1",
      },
    ];

    expect(pdfExportProvenanceLog(cases[0], "success", "C:\\private\\document.pdf"))
      .toBe("enhanced-managed · engine 0.4.0 · typst 0.15.1 · outcome success · document.pdf");
    expect(pdfExportProvenanceLog(cases[1], "failure"))
      .toBe("custom-typst · typst 0.15.1 · outcome failure");
    expect(pdfExportProvenanceLog(cases[2], "cancelled"))
      .toBe("tinymist · tinymist 0.13.0 · typst 0.15.1 · outcome cancelled");
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
