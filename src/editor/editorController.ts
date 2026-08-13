import type { Text, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  foldAll,
  foldEffect,
  foldedRanges,
  unfoldAll,
  unfoldEffect,
} from "@codemirror/language";
import type { PerformanceMetric } from "../performance/diagnostics";
import { editorDiagnosticsStateField } from "./diagnostics";
import { editorMatchQuery } from "./extensions";
import { imageOptimizationWarningField } from "./imageWarnings";
import { cursorRowColumn } from "./verticalCursor";
import { TYPSASTRA_GREEN } from "../ui/brandColors";
import { isAltGraphKeyboardEvent } from "../ui/keyboardModifiers";
import type { EditorFoldRange } from "./folding";

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
  activePath(): string | null;
  pathKey(path: string): string;
  contentMutationDelay(): number;
  onContentMutationStart(path: string): void;
  onContentMutation(path: string, text: string, previewDebounceElapsedMs: number): void;
  onFoldStateChanged(ranges: EditorFoldRange[]): void;
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
  private readonly mutationKeysHeld = new Set<string>();
  private pendingMutationTimer: number | null = null;
  private pendingMutation: { path: string; doc: Text } | null = null;
  private suppressFoldPersistence = false;

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

    editor.contentDOM.addEventListener("keydown", event => {
      if (!this.isMutationKey(event)) return;
      this.mutationKeysHeld.add(event.code || event.key);
    }, { capture: true });
    editor.contentDOM.addEventListener("keyup", event => {
      if (!this.isMutationKey(event)) return;
      this.mutationKeysHeld.delete(event.code || event.key);
      if (this.mutationKeysHeld.size === 0 && this.pendingMutation) {
        this.restartMutationTimer();
      }
    }, { capture: true });
    window.addEventListener("blur", () => {
      this.mutationKeysHeld.clear();
      if (this.pendingMutation) this.restartMutationTimer();
    });

    this.initializeLongTaskObserver();
    this.updateAll();
  }

  scheduleContentMutation(path: string, doc: Text): void {
    if (this.pendingMutation === null) this.port.onContentMutationStart(path);
    this.pendingMutation = { path, doc };
    this.restartMutationTimer();
  }

  flushContentMutation(activePath: string | null, previewDebounceElapsedMs = 0): void {
    if (this.pendingMutationTimer !== null) {
      window.clearTimeout(this.pendingMutationTimer);
      this.pendingMutationTimer = null;
    }
    const pending = this.pendingMutation;
    this.pendingMutation = null;
    const editor = this.editor;
    if (
      !pending
      || !activePath
      || !editor
      || this.port.pathKey(pending.path) !== this.port.pathKey(activePath)
      || pending.doc !== editor.state.doc
    ) return;
    this.port.onContentMutation(
      pending.path,
      pending.doc.toString(),
      previewDebounceElapsedMs,
    );
  }

  handleFoldTransactions(transactions: readonly Transaction[]): void {
    if (
      this.suppressFoldPersistence
      || !transactions.some(transaction =>
        transaction.effects.some(effect => effect.is(foldEffect) || effect.is(unfoldEffect))
      )
    ) return;
    this.port.onFoldStateChanged(this.collectFoldRanges());
  }

  collectFoldRanges(): EditorFoldRange[] {
    const editor = this.editor;
    const ranges: EditorFoldRange[] = [];
    if (!editor) return ranges;
    foldedRanges(editor.state).between(0, editor.state.doc.length, (from, to) => {
      if (from < to) ranges.push({ from, to });
    });
    return ranges;
  }

  restoreFoldState(explicit: boolean, ranges: unknown): EditorFoldRange[] {
    const editor = this.editor;
    if (!editor) return [];
    this.suppressFoldPersistence = true;
    try {
      const normalized = explicit
        ? this.normalizeFoldRanges(ranges, editor.state.doc.length)
        : [];
      this.applyFoldRanges(normalized);
      return normalized;
    } finally {
      this.suppressFoldPersistence = false;
    }
  }

  foldDocument(): void {
    const editor = this.editor;
    if (!editor) return;
    foldAll(editor);
    editor.focus();
  }

  unfoldDocument(): void {
    const editor = this.editor;
    if (!editor) return;
    unfoldAll(editor);
    editor.focus();
  }

  applyFoldRanges(ranges: readonly EditorFoldRange[]): void {
    const editor = this.editor;
    if (!editor) return;
    const effects = [];
    const docLength = editor.state.doc.length;
    foldedRanges(editor.state).between(0, docLength, (from, to) => {
      effects.push(unfoldEffect.of({ from, to }));
    });
    for (const range of this.normalizeFoldRanges(ranges, docLength)) {
      effects.push(foldEffect.of(range));
    }
    if (effects.length > 0) editor.dispatch({ effects });
  }

  normalizeFoldRanges(value: unknown, docLength: number): EditorFoldRange[] {
    if (!Array.isArray(value)) return [];
    const ranges: EditorFoldRange[] = [];
    for (let index = 0; index < value.length; index++) {
      const item = value[index];
      const range = typeof item === "object" && item !== null
        ? item as Partial<EditorFoldRange>
        : typeof item === "number" && typeof value[index + 1] === "number"
          ? { from: item, to: value[++index] as number }
          : null;
      if (
        range
        && typeof range.from === "number"
        && typeof range.to === "number"
        && range.from >= 0
        && range.to <= docLength
        && range.from < range.to
      ) ranges.push({ from: range.from, to: range.to });
    }
    return ranges;
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

    const lineMarkers = new Map<number, "error" | "warning" | "info" | "related">();
    for (const line of this.matchMarkerLines) {
      if (line >= 1 && line <= doc.lines) lineMarkers.set(line, "info");
    }
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity !== "error"
        && diagnostic.severity !== "warning"
        && diagnostic.severity !== "related") continue;
      const line = doc.lineAt(Math.max(0, Math.min(diagnostic.from, doc.length))).number;
      const existing = lineMarkers.get(line);
      if (!existing || diagnostic.severity === "error" || existing === "info") {
        lineMarkers.set(line, diagnostic.severity);
      }
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
        backgroundColor: severity === "error"
          ? "#f14c4c"
          : severity === "related"
            ? "rgba(241, 76, 76, 0.58)"
            : severity === "warning" ? "#cca700" : "#3794ff",
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

  private restartMutationTimer(): void {
    if (this.pendingMutationTimer !== null) window.clearTimeout(this.pendingMutationTimer);
    const delay = this.port.contentMutationDelay();
    this.pendingMutationTimer = window.setTimeout(() => {
      this.pendingMutationTimer = null;
      if (this.mutationKeysHeld.size > 0) return;
      this.flushContentMutation(this.port.activePath(), delay);
    }, delay);
  }

  private isMutationKey(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey) return false;
    if (event.altKey && !isAltGraphKeyboardEvent(event)) return false;
    return event.key.length === 1
      || event.key === "Backspace"
      || event.key === "Delete"
      || event.key === "Enter"
      || event.key === "Tab";
  }
}
