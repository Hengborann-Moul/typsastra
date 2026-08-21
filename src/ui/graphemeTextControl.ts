import { editingPolicyRegistry } from "../editor/editingPolicies/registry";

export type GraphemeTextControl = HTMLInputElement | HTMLTextAreaElement;

const installedControls = new WeakSet<object>();

export function previousTextControlBoundary(text: string, offset: number, selection = false): number {
  const clamped = clampOffset(text, offset);
  let previous = 0;
  for (const boundary of editingPolicyRegistry.boundaries(text)) {
    if (boundary.to >= clamped) {
      const unicodeBoundary = clamped <= boundary.from ? previous : boundary.from;
      return editingPolicyRegistry.movementBoundary(
        text,
        clamped,
        "backward",
        unicodeBoundary,
        selection,
      );
    }
    previous = boundary.to;
  }
  return previous;
}

export function nextTextControlBoundary(text: string, offset: number, selection = false): number {
  const clamped = clampOffset(text, offset);
  for (const boundary of editingPolicyRegistry.boundaries(text)) {
    if (boundary.from <= clamped && clamped < boundary.to) {
      return editingPolicyRegistry.movementBoundary(
        text,
        clamped,
        "forward",
        boundary.to,
        selection,
      );
    }
    if (clamped < boundary.from) {
      return editingPolicyRegistry.movementBoundary(
        text,
        clamped,
        "forward",
        boundary.from,
        selection,
      );
    }
  }
  return text.length;
}

export function snapTextControlOffset(
  text: string,
  offset: number,
  bias: "nearest" | "backward" | "forward" = "nearest",
): number {
  const clamped = clampOffset(text, offset);
  for (const boundary of editingPolicyRegistry.boundaries(text)) {
    if (clamped <= boundary.from) return boundary.from;
    if (clamped < boundary.to) {
      if (bias === "backward") return boundary.from;
      if (bias === "forward") return boundary.to;
      return clamped - boundary.from <= boundary.to - clamped ? boundary.from : boundary.to;
    }
  }
  return text.length;
}

/** Apply Typsastra's script-aware grapheme policy to a native text control. */
export function installGraphemeTextControl(control: GraphemeTextControl): void {
  if (installedControls.has(control)) return;
  installedControls.add(control);

  let pointerActive = false;
  let compositionActive = false;
  let normalizing = false;

  const normalizeSelection = () => {
    if (pointerActive || compositionActive || normalizing) return;
    const start = control.selectionStart;
    const end = control.selectionEnd;
    if (start === null || end === null) return;
    const direction = control.selectionDirection ?? "none";
    const snappedStart = snapTextControlOffset(control.value, start, start === end ? "nearest" : "backward");
    const snappedEnd = snapTextControlOffset(control.value, end, start === end ? "nearest" : "forward");
    if (snappedStart === start && snappedEnd === end) return;
    normalizing = true;
    control.setSelectionRange(snappedStart, snappedEnd, direction);
    normalizing = false;
  };

  control.addEventListener("keydown", rawEvent => {
    const event = rawEvent as KeyboardEvent;
    if (event.defaultPrevented || event.isComposing || compositionActive) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      moveSelection(control, event.key === "ArrowLeft" ? "backward" : "forward", event.shiftKey);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      deleteSelection(control, event.key === "Backspace" ? "backward" : "forward");
    }
  });

  control.addEventListener("beforeinput", rawEvent => {
    const event = rawEvent as InputEvent;
    if (compositionActive || event.isComposing || event.defaultPrevented) return;
    if (event.inputType !== "deleteContentBackward" && event.inputType !== "deleteContentForward") return;
    event.preventDefault();
    deleteSelection(control, event.inputType === "deleteContentBackward" ? "backward" : "forward");
  });

  control.addEventListener("pointerdown", () => {
    pointerActive = true;
  });
  control.addEventListener("pointerup", () => {
    pointerActive = false;
    normalizeSelection();
  });
  control.addEventListener("pointercancel", () => {
    pointerActive = false;
    normalizeSelection();
  });
  control.addEventListener("lostpointercapture", () => {
    pointerActive = false;
    normalizeSelection();
  });
  control.addEventListener("blur", () => {
    pointerActive = false;
    normalizeSelection();
  });
  control.addEventListener("select", normalizeSelection);
  control.addEventListener("compositionstart", () => {
    compositionActive = true;
  });
  control.addEventListener("compositionend", () => {
    compositionActive = false;
    normalizeSelection();
  });
}

function moveSelection(
  control: GraphemeTextControl,
  direction: "backward" | "forward",
  extend: boolean,
): void {
  const start = control.selectionStart ?? 0;
  const end = control.selectionEnd ?? start;
  const selectionDirection = control.selectionDirection ?? "none";
  if (!extend) {
    const collapsed = start !== end
      ? (direction === "backward" ? start : end)
      : (direction === "backward"
        ? previousTextControlBoundary(control.value, start)
        : nextTextControlBoundary(control.value, end));
    const snapped = snapTextControlOffset(control.value, collapsed, direction);
    control.setSelectionRange(snapped, snapped, "none");
    return;
  }

  const anchor = selectionDirection === "backward" ? end : start;
  const focus = selectionDirection === "backward" ? start : end;
  const nextFocus = direction === "backward"
    ? previousTextControlBoundary(control.value, focus, true)
    : nextTextControlBoundary(control.value, focus, true);
  if (nextFocus < anchor) control.setSelectionRange(nextFocus, anchor, "backward");
  else control.setSelectionRange(anchor, nextFocus, nextFocus === anchor ? "none" : "forward");
}

function deleteSelection(control: GraphemeTextControl, direction: "backward" | "forward"): void {
  const start = control.selectionStart ?? 0;
  const end = control.selectionEnd ?? start;
  let from = start;
  let to = end;
  if (start !== end) {
    from = snapTextControlOffset(control.value, start, "backward");
    to = snapTextControlOffset(control.value, end, "forward");
  } else if (direction === "backward") {
    const range = editingPolicyRegistry.backwardDeletionRange(control.value, start);
    if (!range) return;
    ({ from, to } = range);
  } else {
    const range = editingPolicyRegistry.forwardDeletionRange(control.value, start);
    if (!range) return;
    ({ from, to } = range);
  }
  control.setRangeText("", from, to, "end");
  control.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: direction === "backward" ? "deleteContentBackward" : "deleteContentForward",
  }));
}

function clampOffset(text: string, offset: number): number {
  return Math.max(0, Math.min(offset, text.length));
}
