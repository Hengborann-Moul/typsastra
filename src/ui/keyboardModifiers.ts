type KeyboardModifierEvent = Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey"> & {
  getModifierState?: (keyArg: string) => boolean;
};

/**
 * AltGr is exposed as Ctrl+Alt by Windows keyboard layouts. Chromium normally
 * also reports AltGraph, but the explicit state is not consistent across
 * WebView/runtime and keyboard-layout combinations, so Ctrl+Alt is the
 * compatibility fallback. Typsastra does not assign Ctrl+Alt app shortcuts.
 */
export function isAltGraphKeyboardEvent(event: KeyboardModifierEvent): boolean {
  try {
    if (event.getModifierState?.("AltGraph")) return true;
  } catch {
    // Fall through for incomplete KeyboardEvent implementations.
  }
  return event.ctrlKey && event.altKey && !event.metaKey;
}
