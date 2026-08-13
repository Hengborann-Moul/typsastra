export type EditorCaretInputOptions = {
  shellClass?: string;
  measureClass?: string;
  caretClass?: string;
};

/** Wrap an input with the same full-height caret used by the editor. */
export function wrapEditorCaretInput(
  field: HTMLInputElement,
  options: EditorCaretInputOptions = {},
): HTMLSpanElement {
  const shell = document.createElement("span");
  shell.className = ["typsastra-caret-input-shell", options.shellClass]
    .filter(Boolean)
    .join(" ");
  const measure = document.createElement("span");
  measure.className = ["typsastra-caret-measure", options.measureClass]
    .filter(Boolean)
    .join(" ");
  const caret = document.createElement("span");
  caret.className = ["typsastra-input-caret", options.caretClass]
    .filter(Boolean)
    .join(" ");
  shell.append(field, measure, caret);

  const updateCaret = () => {
    const selection = field.selectionStart ?? 0;
    const selectionEnd = field.selectionEnd ?? selection;
    caret.style.visibility = selection === selectionEnd ? "visible" : "hidden";
    measure.textContent = field.value.slice(0, selection) || "\u200b";
    const measuredWidth = selection === 0 ? 0 : measure.getBoundingClientRect().width;
    caret.style.left = `calc(var(--editor-input-horizontal-inset, 10px) + ${measuredWidth - field.scrollLeft}px)`;
  };
  for (const event of ["focus", "input", "click", "keyup", "select", "scroll"]) {
    field.addEventListener(event, updateCaret);
  }
  field.addEventListener("focus", () => requestAnimationFrame(updateCaret));
  updateCaret();
  return shell;
}
