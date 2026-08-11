import type { EditorView } from "@codemirror/view";
import { editorDiagnosticsStateField } from "./diagnostics";
import { editorMatchQuery } from "./extensions";
import { imageOptimizationWarningField } from "./imageWarnings";
import { TYPSASTRA_GREEN } from "../ui/brandColors";

/** Owns editor-scroller annotations that are independent of document IO. */
export class EditorController {
  private editor: EditorView | null = null;
  private caretMarker: HTMLElement | null = null;
  private diagnosticMarkerLayer: HTMLElement | null = null;
  private matchMarkerFrame: number | null = null;
  private matchMarkerGeneration = 0;
  private matchMarkerLines = new Set<number>();

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

    this.updateAll();
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
}
