import { describe, expect, test } from "bun:test";
import { isAltGraphKeyboardEvent } from "../src/ui/keyboardModifiers";

const keyboardEvent = (
  modifiers: Partial<Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey">> = {},
  altGraph = false
) => ({
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  getModifierState: (name: string) => name === "AltGraph" && altGraph,
  ...modifiers
});

describe("keyboard modifiers", () => {
  test("recognizes an explicitly reported AltGraph modifier", () => {
    expect(isAltGraphKeyboardEvent(keyboardEvent({}, true))).toBeTrue();
  });

  test("recognizes the Windows Ctrl+Alt representation of AltGr", () => {
    expect(isAltGraphKeyboardEvent(keyboardEvent({ ctrlKey: true, altKey: true }))).toBeTrue();
  });

  test("does not suppress ordinary Ctrl, Alt, or macOS Command shortcuts", () => {
    expect(isAltGraphKeyboardEvent(keyboardEvent({ ctrlKey: true }))).toBeFalse();
    expect(isAltGraphKeyboardEvent(keyboardEvent({ altKey: true }))).toBeFalse();
    expect(isAltGraphKeyboardEvent(keyboardEvent({ metaKey: true }))).toBeFalse();
    expect(isAltGraphKeyboardEvent(keyboardEvent({ ctrlKey: true, altKey: true, metaKey: true }))).toBeFalse();
  });
});
