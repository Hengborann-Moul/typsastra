import type { EditorView } from "@codemirror/view";
import type { PerformanceMetric } from "../performance/diagnostics";
import { editorDiagnosticsStateField } from "./diagnostics";
import { editorMatchQuery } from "./extensions";
import { imageOptimizationWarningField } from "./imageWarnings";
import { cursorRowColumn } from "./verticalCursor";
import { TYPSASTRA_GREEN } from "../ui/brandColors";

type EditorInputProfile = {
  sequence: number;
  inputType: string;
  inputStartedAt: number;
  listenerStartedAt: number;
};

export interface EditorControllerPort {
  performanceEnabled(): boolean;
  recordPerformance(metric: Omit<PerformanceMetric, "recordedAt">): void;
  logLayoutRefresh(reason: string): void;
  suppressPreviewSync(durationMs: number): void;
  revealPreviewAtCursor(cursor: number): void;
}

/** Owns editor-scroller annotations that are independent of document IO. */
export class EditorController {
  private editor: EditorView | null = null;
  private caretMarker: HTMLElement | null = null;
  private diagnosticMarkerLayer: HTMLElement | null = null;
  private matchMarkerFrame: number | null = null;
  private matchMarkerGeneration = 0;
  private matchMarkerLines = new Set<number>();
  private inputSequence = 0;
  private inputStartedAt: number | null = null;
  private inputType = "unknown";
  private lastInputAt = 0;
  private longTaskObserver: PerformanceObserver | null = null;
  private scrollbarPointerActive = false;

  constructor(private readonly port: EditorControllerPort) {}

  install(editor: EditorView): void {
    this.editor = editor;

    const caretMarker = document.createElement("div");
    caretMarker.className = "editor-caret-scroll-marker";
    caretMarker.setAttribute("aria-hidden", "true");
    Object.assign(caretMarker.style, {
      position: "absolute",
      right: "0px",
      width: "15px",
      height: "2px",
      background: TYPSASTRA_GREEN,
      pointerEvents: "none",
      zIndex: "20",
    });
    editor.dom.appendChild(caretMarker);
    this.caretMarker = caretMarker;

    const diagnosticLayer = document.createElement("div");
    diagnosticLayer.className = "editor-diagnostic-scroll-marker-layer";
    diagnosticLayer.setAttribute("aria-hidden", "true");
    Object.assign(diagnosticLayer.style, {
      position: "absolute",
      top: "0",
      right: "2px",
      width: "5px",
      height: "100%",
      pointerEvents: "none",
      zIndex: "19",
    });
    editor.dom.appendChild(diagnosticLayer);
    this.diagnosticMarkerLayer = diagnosticLayer;

    editor.contentDOM.addEventListener("beforeinput", event => {
      if (!this.port.performanceEnabled()) return;
      this.inputSequence += 1;
      this.inputStartedAt = performance.now();
      this.lastInputAt = this.inputStartedAt;
      this.inputType = event.inputType || "unknown";
    }, { capture: true });

    editor.dom.addEventListener("pointerup", event => {
      if (!(event instanceof PointerEvent) || event.button !== 0) return;
      if (this.scrollbarPointerActive) {
        this.scrollbarPointerActive = false;
        this.port.suppressPreviewSync(250);
        return;
      }
      window.setTimeout(() => {
        if (this.editor !== editor) return;
        this.port.revealPreviewAtCursor(editor.state.selection.main.head);
      }, 0);
    }, true);

    editor.scrollDOM.addEventListener("pointerdown", event => {
      if (!(event instanceof PointerEvent) || event.button !== 0) return;

      const scrollDOM = editor.scrollDOM;
      const rect = scrollDOM.getBoundingClientRect();
      const scrollbarWidth = Math.max(12, scrollDOM.offsetWidth - scrollDOM.clientWidth);
      const inVerticalScrollbar = scrollDOM.scrollHeight > scrollDOM.clientHeight
        && event.clientX >= rect.right - scrollbarWidth;
      if (!inVerticalScrollbar) return;

      event.preventDefault();
      event.stopPropagation();
      this.scrollbarPointerActive = true;
      this.port.suppressPreviewSync(1000);

      const trackHeight = scrollDOM.clientHeight;
      const maxScrollTop = Math.max(0, scrollDOM.scrollHeight - trackHeight);
      const thumbHeight = Math.max(20, trackHeight * (trackHeight / scrollDOM.scrollHeight));
      const pointerY = event.clientY - rect.top;
      const thumbCenterY = Math.max(
        thumbHeight / 2,
        Math.min(trackHeight - thumbHeight / 2, pointerY),
      );
      const thumbTravel = Math.max(1, trackHeight - thumbHeight);
      scrollDOM.scrollTop = ((thumbCenterY - thumbHeight / 2) / thumbTravel) * maxScrollTop;
    }, true);

    window.addEventListener("pointerup", () => {
      if (!this.scrollbarPointerActive) return;
      window.setTimeout(() => {
        this.scrollbarPointerActive = false;
      }, 0);
    }, true);
    editor.scrollDOM.addEventListener("scroll", () => {
      this.port.suppressPreviewSync(500);
    }, { passive: true });

    this.initializeLongTaskObserver();
    this.updateAll();
  }

  beginInputProfile(): EditorInputProfile | null {
    if (!this.port.performanceEnabled() || this.inputStartedAt === null) return null;
    return {
      sequence: this.inputSequence,
      inputType: this.inputType,
      inputStartedAt: this.inputStartedAt,
      listenerStartedAt: performance.now(),
    };
  }

  finishInputProfile(profile: EditorInputProfile | null, documentLength: number, composing: boolean): void {
    if (!profile) return;
    const listenerFinishedAt = performance.now();
    const detail = {
      sequence: profile.sequence,
      inputType: profile.inputType,
      documentLength,
      composing,
    };
    this.port.recordPerformance({
      name: "editor.input-update",
      milliseconds: profile.listenerStartedAt - profile.inputStartedAt,
      detail,
    });
    this.port.recordPerformance({
      name: "editor.update-listener",
      milliseconds: listenerFinishedAt - profile.listenerStartedAt,
      detail,
    });
    this.inputStartedAt = null;
    requestAnimationFrame(() => {
      this.port.recordPerformance({
        name: "editor.input-frame",
        milliseconds: performance.now() - profile.inputStartedAt,
        detail,
      });
    });
  }

  updateCursorStatus(): void {
    const editor = this.editor;
    const status = document.getElementById("cursor-position-status");
    const label = status?.querySelector<HTMLElement>(".status-label");
    if (!editor || !status || !label) return;
    const { row, column } = cursorRowColumn(
      editor.state.doc,
      editor.state.selection.main.head,
    );
    label.textContent = `Ln ${row}, Col ${column}`;
    status.setAttribute("aria-label", `Cursor at row ${row}, column ${column}`);
  }

  refreshLayout(reason: string): void {
    const editor = this.editor;
    if (!editor) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.editor !== editor) return;
      editor.requestMeasure();
      this.port.logLayoutRefresh(reason);
    }));
  }

  shouldForwardSyncSelectionUpdate(update: {
    selectionSet: boolean;
    transactions: readonly { isUserEvent(event: string): boolean }[];
  }): boolean {
    return update.selectionSet && update.transactions.some(transaction =>
      transaction.isUserEvent("select.pointer")
      || transaction.isUserEvent("select.search")
    );
  }

  updateAll(): void {
    this.updateCaretMarker();
    this.updateDiagnosticMarkers();
    this.scheduleMatchMarkers();
  }

  updateCaretMarker(): void {
    const marker = this.caretMarker;
    const editor = this.editor;
    if (!marker || !editor) return;

    const doc = editor.state.doc;
    if (doc.lines <= 1) {
      marker.style.display = "none";
      return;
    }

    const caretLine = doc.lineAt(editor.state.selection.main.head).number;
    const documentRatio = (caretLine - 1) / Math.max(1, doc.lines - 1);
    const documentHeight = Math.max(0, editor.contentHeight - editor.defaultLineHeight);
    const ratio = documentRatio * (documentHeight / Math.max(1, editor.scrollDOM.scrollHeight));
    const markerHeight = 2;
    const top = ratio * Math.max(0, editor.scrollDOM.clientHeight - markerHeight);

    marker.style.display = "";
    marker.style.top = `${top}px`;
    marker.title = `Caret: line ${caretLine}`;
  }

  updateDiagnosticMarkers(): void {
    const layer = this.diagnosticMarkerLayer;
    const editor = this.editor;
    if (!layer || !editor) return;

    const diagnostics = editor.state.field(editorDiagnosticsStateField, false) ?? [];
    const imageWarnings = editor.state.field(imageOptimizationWarningField, false);
    const doc = editor.state.doc;
    const trackHeight = editor.scrollDOM.clientHeight;
    const markerHeight = 5;
    const documentHeight = Math.max(0, editor.contentHeight - editor.defaultLineHeight);
    const documentTrackRatio = documentHeight / Math.max(1, editor.scrollDOM.scrollHeight);

    layer.style.height = `${trackHeight}px`;
    layer.replaceChildren();
    if (doc.lines <= 1) return;

    const lineMarkers = new Map<number, "error" | "warning" | "info">();
    for (const line of this.matchMarkerLines) {
      if (line >= 1 && line <= doc.lines) lineMarkers.set(line, "info");
    }
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity !== "error" && diagnostic.severity !== "warning") continue;
      const line = doc.lineAt(Math.max(0, Math.min(diagnostic.from, doc.length))).number;
      const existing = lineMarkers.get(line);
      if (!existing || diagnostic.severity === "error") lineMarkers.set(line, diagnostic.severity);
    }
    imageWarnings?.between(0, doc.length, from => {
      const line = doc.lineAt(Math.max(0, Math.min(from, doc.length))).number;
      if (!lineMarkers.has(line)) lineMarkers.set(line, "warning");
    });

    for (const [line, severity] of lineMarkers) {
      const documentRatio = (line - 1) / Math.max(1, doc.lines - 1);
      const top = documentRatio * documentTrackRatio * Math.max(0, trackHeight - markerHeight);
      const marker = document.createElement("div");
      marker.className = `editor-diagnostic-scroll-marker editor-diagnostic-scroll-marker-${severity}`;
      Object.assign(marker.style, {
        position: "absolute",
        right: "0",
        top: `${top}px`,
        width: "5px",
        height: `${markerHeight}px`,
        backgroundColor: severity === "error" ? "#f14c4c" : severity === "warning" ? "#cca700" : "#3794ff",
        pointerEvents: "none",
      });
      layer.appendChild(marker);
    }
  }

  scheduleMatchMarkers(): void {
    const editor = this.editor;
    if (!editor) return;

    const generation = ++this.matchMarkerGeneration;
    if (this.matchMarkerFrame !== null) cancelAnimationFrame(this.matchMarkerFrame);
    this.matchMarkerFrame = null;

    const state = editor.state;
    const query = editorMatchQuery(state);
    const lines = new Set<number>();
    const selection = state.selection.main;
    if (query && !selection.empty) {
      const selectedMatch = query.getCursor(state, selection.from, selection.to).next();
      if (!selectedMatch.done && selectedMatch.value.from === selection.from && selectedMatch.value.to === selection.to) {
        lines.add(state.doc.lineAt(selection.from).number);
      }
    }
    this.matchMarkerLines = new Set(lines);
    this.updateDiagnosticMarkers();
    if (!query) return;

    const cursor = query.getCursor(state);
    let completedFrames = 0;
    const scan = () => {
      if (generation !== this.matchMarkerGeneration) return;
      const startedAt = performance.now();
      for (let processed = 0; processed < 500 && performance.now() - startedAt < 4; processed += 1) {
        const result = cursor.next();
        if (result.done) {
          this.matchMarkerFrame = null;
          this.matchMarkerLines = lines;
          this.updateDiagnosticMarkers();
          return;
        }
        lines.add(state.doc.lineAt(result.value.from).number);
      }
      completedFrames += 1;
      if (completedFrames === 1 || completedFrames % 4 === 0) {
        this.matchMarkerLines = new Set(lines);
        this.updateDiagnosticMarkers();
      }
      this.matchMarkerFrame = requestAnimationFrame(scan);
    };
    this.matchMarkerFrame = requestAnimationFrame(scan);
  }

  private initializeLongTaskObserver(): void {
    if (
      this.longTaskObserver
      || typeof PerformanceObserver === "undefined"
      || !PerformanceObserver.supportedEntryTypes?.includes("longtask")
    ) return;
    this.longTaskObserver = new PerformanceObserver(list => {
      if (!this.port.performanceEnabled() || performance.now() - this.lastInputAt > 1_500) return;
      for (const entry of list.getEntries()) {
        this.port.recordPerformance({
          name: "editor.long-task",
          milliseconds: entry.duration,
          detail: {
            inputAgeMs: Math.max(0, entry.startTime - this.lastInputAt),
            entryType: entry.entryType,
          },
        });
      }
    });
    this.longTaskObserver.observe({ type: "longtask", buffered: false });
  }
}
