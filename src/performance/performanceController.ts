import { invoke } from "@tauri-apps/api/core";
import type { LspLogEntry } from "../compiler/lsp";
import type { PreviewMemorySnapshot } from "../preview/previewFrame";
import {
  PerformanceDiagnostics,
  type PerformanceMetric,
  type PerformanceMetricName,
} from "./diagnostics";

export type StartupTimingEntry = {
  source: string;
  label: string;
  ms: number;
};

type ProcessMemorySample = {
  pid: number;
  parentPid: number;
  name: string;
  workingSetBytes: number;
};

type MemoryDiagnosticTotals = {
  jsHeapBytes: number;
  relatedBytes: number;
  webviewBytes: number;
  tinymistBytes: number;
  backendBytes: number;
};

export interface PerformanceControllerPort {
  isLogEnabled(category: "performance" | "memory"): boolean;
  appendLog(entry: LspLogEntry): void;
  previewMemorySnapshot(): PreviewMemorySnapshot;
  lastPdfPath(): string | null;
  openTabCount(): number;
  openDocumentUtf16(): number;
  editorUndoDepth(): number;
}

export class PerformanceController {
  private readonly diagnostics = new PerformanceDiagnostics(metric => this.publishMetric(metric));
  private readonly summaryCounts = new Map<PerformanceMetricName, number>();
  private readonly startupTimings: StartupTimingEntry[] = [];
  private readonly loggedNativeStartupTimings = new Set<string>();
  private memoryDiagnosticSequence = 0;
  private previousMemoryDiagnostic: MemoryDiagnosticTotals | null = null;

  public constructor(private readonly port: PerformanceControllerPort) {}

  public record(metric: Omit<PerformanceMetric, "recordedAt">): PerformanceMetric {
    return this.diagnostics.record(metric);
  }

  public recordFirst(metric: Omit<PerformanceMetric, "recordedAt">): PerformanceMetric | null {
    return this.diagnostics.recordFirst(metric);
  }

  public recordStartupTiming(source: string, label: string, start: number): void {
    this.recordStartupTimingEntry({ source, label, ms: performance.now() - start });
  }

  public recordStartupTimingEntry(entry: StartupTimingEntry): void {
    this.startupTimings.push(entry);
    this.logStartupTiming(entry);
  }

  public async logNativeStartupTimings(): Promise<void> {
    if (!this.port.isLogEnabled("performance")) return;
    try {
      const nativeTimings = await invoke<StartupTimingEntry[]>("get_startup_timings");
      for (const entry of nativeTimings) {
        const key = `${entry.source}\u0000${entry.label}`;
        if (this.loggedNativeStartupTimings.has(key)) continue;
        this.loggedNativeStartupTimings.add(key);
        this.logStartupTiming(entry);
      }
    } catch (error) {
      console.warn("Failed to read native startup timings:", error);
    }
  }

  public timeStartupSync<T>(label: string, action: () => T): T {
    const start = performance.now();
    try {
      return action();
    } finally {
      this.recordStartupTiming("frontend startup", label, start);
    }
  }

  public async timeStartup<T>(label: string, action: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await action();
    } finally {
      this.recordStartupTiming("frontend startup", label, start);
    }
  }

  public async logMemoryDiagnostics(
    stage: string,
    detail: Record<string, number | string | boolean> = {},
  ): Promise<void> {
    if (!this.port.isLogEnabled("memory")) return;
    const sequence = ++this.memoryDiagnosticSequence;
    const heap = (performance as Performance & {
      memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number };
    }).memory;
    const processes = await invoke<ProcessMemorySample[]>("get_memory_diagnostics").catch(error => {
      this.port.appendLog({
        kind: "warning",
        source: "memory diagnostics",
        message: `Memory sample ${sequence} native process query failed: ${String(error)}`,
      });
      return [];
    });
    const categoryBytes = (predicate: (name: string) => boolean) => processes
      .filter(process => predicate(process.name.toLocaleLowerCase()))
      .reduce((total, process) => total + process.workingSetBytes, 0);
    const webviewBytes = categoryBytes(name => name.includes("msedgewebview2") || name.includes("webkit"));
    const tinymistBytes = categoryBytes(name => name.includes("tinymist"));
    const relatedBytes = processes.reduce((total, process) => total + process.workingSetBytes, 0);
    const backendBytes = Math.max(0, relatedBytes - webviewBytes - tinymistBytes);
    const totals: MemoryDiagnosticTotals = {
      jsHeapBytes: heap?.usedJSHeapSize ?? 0,
      relatedBytes,
      webviewBytes,
      tinymistBytes,
      backendBytes,
    };
    const previous = this.previousMemoryDiagnostic;
    this.previousMemoryDiagnostic = totals;
    const preview = this.port.previewMemorySnapshot();
    const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
    const delta = (value: number, before: number | undefined) => before === undefined
      ? "n/a"
      : `${value - before >= 0 ? "+" : ""}${mib(value - before)} MiB`;
    const processSummary = processes
      .map(process => `${process.name}[${process.pid}]=${mib(process.workingSetBytes)} MiB`)
      .join(", ");
    const detailSummary = Object.entries(detail)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ");
    this.port.appendLog({
      kind: "info",
      source: "memory diagnostics",
      message: [
        `Memory sample ${sequence} (${stage})`,
        `related=${mib(relatedBytes)} MiB (${delta(relatedBytes, previous?.relatedBytes)})`,
        `webview=${mib(webviewBytes)} MiB (${delta(webviewBytes, previous?.webviewBytes)})`,
        `tinymist=${mib(tinymistBytes)} MiB (${delta(tinymistBytes, previous?.tinymistBytes)})`,
        `backend=${mib(backendBytes)} MiB (${delta(backendBytes, previous?.backendBytes)})`,
        `jsHeap=${heap?.usedJSHeapSize === undefined ? "unavailable" : `${mib(heap.usedJSHeapSize)} MiB (${delta(heap.usedJSHeapSize, previous?.jsHeapBytes)})`}`,
        `jsHeapTotal=${heap?.totalJSHeapSize === undefined ? "unavailable" : `${mib(heap.totalJSHeapSize)} MiB`}`,
        `pdf=${mib(preview.pdfBytes)} MiB/${preview.pdfPages} pages/gen ${preview.pdfGeneration}`,
        `pdfTransport=${preview.pdfTransport}; pdfRead=${mib(preview.pdfBytesRead)} MiB/${preview.pdfRangeRequests} range request(s)`,
        `finalCanvas=${preview.residentFinalCanvases}; mountedCanvas=${preview.residentCanvases} (${mib(preview.canvasPixels * 4)} MiB estimated RGBA)`,
        `fontFaces=${preview.fontFaces}`,
        `activeRenders=${preview.activeRenders}; pdfLoading=${preview.loading}`,
        `lastPdfPath=${this.port.lastPdfPath() || "none"}`,
        `openTabs=${this.port.openTabCount()}; openDocumentUtf16=${this.port.openDocumentUtf16()}; undoDepth=${this.port.editorUndoDepth()}`,
        detailSummary ? `detail: ${detailSummary}` : "",
        `processes: ${processSummary || "unavailable"}`,
      ].filter(Boolean).join("; "),
    });
  }

  private logStartupTiming(entry: StartupTimingEntry): void {
    if (!this.port.isLogEnabled("performance")) return;
    console.info(`[startup timing] ${entry.source}: ${entry.label} took ${entry.ms.toFixed(1)} ms`);
  }

  private publishMetric(metric: PerformanceMetric): void {
    if (!this.port.isLogEnabled("performance")) return;
    if (metric.name.startsWith("editor.") && metric.milliseconds !== undefined) {
      const count = (this.summaryCounts.get(metric.name) ?? 0) + 1;
      this.summaryCounts.set(metric.name, count);
      if (metric.name !== "editor.long-task") {
        if (count % 20 !== 0) return;
        const summary = this.diagnostics.summary(metric.name);
        if (!summary) return;
        const message = `${metric.name} rolling summary: n=${summary.samples}; p50=${summary.p50.toFixed(1)} ms; p95=${summary.p95.toFixed(1)} ms; max=${summary.maximum.toFixed(1)} ms`;
        console.info(`[performance] ${message}`);
        this.port.appendLog({
          kind: summary.p95 > 16 ? "warning" : "info",
          source: "editor performance",
          message,
        });
        return;
      }
    }
    const value = metric.milliseconds !== undefined
      ? `${metric.milliseconds.toFixed(1)} ms`
      : metric.bytes !== undefined
        ? `${(metric.bytes / 1024 / 1024).toFixed(1)} MiB`
        : "recorded";
    console.info(`[performance] ${metric.name}: ${value}`, metric.detail ?? {});
    this.port.appendLog({
      kind: "info",
      source: "performance",
      message: `${metric.name}: ${value}${metric.detail ? ` (${JSON.stringify(metric.detail)})` : ""}`,
    });
    if (metric.name.startsWith("preview.") && metric.milliseconds !== undefined) {
      const count = (this.summaryCounts.get(metric.name) ?? 0) + 1;
      this.summaryCounts.set(metric.name, count);
      if (count % 20 === 0) {
        const summary = this.diagnostics.summary(metric.name);
        if (summary) {
          this.port.appendLog({
            kind: "info",
            source: "performance",
            message: `${metric.name} rolling summary: n=${summary.samples}; p50=${summary.p50.toFixed(1)} ms; p95=${summary.p95.toFixed(1)} ms; max=${summary.maximum.toFixed(1)} ms`,
          });
        }
      }
    }
  }
}
