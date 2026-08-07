import { RangeSet, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { GutterMarker, gutter } from "@codemirror/view";
import { createAppIcon } from "../ui/icons";
import { editorDiagnosticsStateField } from "./diagnostics";

export type ImageOptimizationWarning = {
  from: number;
  to: number;
  message: string;
};

export const setImageOptimizationWarningsEffect = StateEffect.define<ImageOptimizationWarning[]>({
  map(warnings, mapping) {
    return warnings.map((warning) => ({
      ...warning,
      from: mapping.mapPos(warning.from),
      to: mapping.mapPos(warning.to)
    }));
  }
});

class ImageOptimizationMarker extends GutterMarker {
  constructor(readonly message: string) {
    super();
  }

  eq(other: GutterMarker): boolean {
    return other instanceof ImageOptimizationMarker && other.message === this.message;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = "cm-image-optimization-marker";
    marker.appendChild(createAppIcon("triangleAlert", { size: 17 }));
    marker.title = this.message;
    marker.setAttribute("aria-label", this.message);
    return marker;
  }
}

class LspErrorMarker extends GutterMarker {
  constructor(readonly message: string) {
    super();
  }

  eq(other: GutterMarker): boolean {
    return other instanceof LspErrorMarker && other.message === this.message;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    const icon = createAppIcon("circleX", { size: 17 });
  
    marker.className = "cm-lsp-error-marker";
    marker.title = this.message;
    marker.setAttribute("aria-label", this.message);
  
    icon.style.color = "#f14c4c";
  
    Object.assign(marker.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      verticalAlign: "middle",
      color: "#f14c4c"
    });
  
    marker.appendChild(icon);
  
    return marker;
  }
}

class ImageOptimizationSpacerMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = "cm-image-optimization-marker-spacer";
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }
}

const imageOptimizationWarningField = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty;
  },

  update(markers, transaction) {
    let next = markers.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (!effect.is(setImageOptimizationWarningsEffect)) continue;

      const byLine = new Map<number, string[]>();

      for (const warning of effect.value) {
        const position = Math.max(0, Math.min(warning.from, transaction.state.doc.length));
        const line = transaction.state.doc.lineAt(position);
        const messages = byLine.get(line.from) ?? [];
        if (!messages.includes(warning.message)) messages.push(warning.message);
        byLine.set(line.from, messages);
      }

      const builder = new RangeSetBuilder<GutterMarker>();

      for (const [lineFrom, messages] of [...byLine].sort((left, right) => left[0] - right[0])) {
        builder.add(lineFrom, lineFrom, new ImageOptimizationMarker(messages.join("\n\n")));
      }

      next = builder.finish();
    }

    return next;
  }
});

const sharedWarningGutter = gutter({
  class: "cm-warningGutter",

  markers(view) {
    const imageMarkers = view.state.field(imageOptimizationWarningField);
    const diagnostics = view.state.field(editorDiagnosticsStateField, false) ?? [];

    const byLine = new Map<number, { severity: "error" | "image"; message: string }>();

    imageMarkers.between(0, view.state.doc.length, (from, _to, marker) => {
      if (marker instanceof ImageOptimizationMarker) {
        byLine.set(from, { severity: "image", message: marker.message });
      }
    });

    for (const diagnostic of diagnostics) {
      if (diagnostic.severity !== "error") continue;

      const position = Math.max(0, Math.min(diagnostic.from, view.state.doc.length));
      const line = view.state.doc.lineAt(position);
      const existing = byLine.get(line.from);

      if (existing?.severity === "error") {
        if (!existing.message.includes(diagnostic.message)) {
          existing.message += `\n\n${diagnostic.message}`;
        }
      } else {
        byLine.set(line.from, {
          severity: "error",
          message: diagnostic.message
        });
      }
    }

    const builder = new RangeSetBuilder<GutterMarker>();

    for (const [lineFrom, marker] of [...byLine].sort((left, right) => left[0] - right[0])) {
      builder.add(
        lineFrom,
        lineFrom,
        marker.severity === "error"
          ? new LspErrorMarker(marker.message)
          : new ImageOptimizationMarker(marker.message)
      );
    }

    return builder.finish();
  },

  initialSpacer: () => new ImageOptimizationSpacerMarker()
});

export const imageOptimizationWarningsExtension: Extension = [
  imageOptimizationWarningField,
  sharedWarningGutter
];