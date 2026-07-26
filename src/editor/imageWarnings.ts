import { RangeSet, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { GutterMarker, lineNumberMarkers } from "@codemirror/view";
import { createAppIcon } from "../ui/icons";

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
  },

  provide(field) {
    return lineNumberMarkers.from(field);
  }
});

export const imageOptimizationWarningsExtension: Extension = imageOptimizationWarningField;
