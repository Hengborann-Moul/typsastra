import { describe, expect, test } from "bun:test";
import {
  parsePersistedWindowState,
  windowBoundsAreVisible
} from "../src/window/windowStateController";

describe("main window state", () => {
  test("validates persisted normal bounds", () => {
    expect(parsePersistedWindowState(JSON.stringify({
      x: 100,
      y: 80,
      width: 1400,
      height: 900,
      maximized: true
    }))).toEqual({ x: 100, y: 80, width: 1400, height: 900, maximized: true });
    expect(parsePersistedWindowState('{"x":0,"y":0,"width":200,"height":100,"maximized":false}'))
      .toBeNull();
    expect(parsePersistedWindowState("invalid")).toBeNull();
  });

  test("rejects window positions that no longer intersect a monitor", () => {
    const state = { x: 2000, y: 100, width: 1000, height: 700, maximized: false };
    expect(windowBoundsAreVisible(state, [
      { x: 0, y: 0, width: 1920, height: 1080 }
    ])).toBeFalse();
    expect(windowBoundsAreVisible(state, [
      { x: 1920, y: 0, width: 1920, height: 1080 }
    ])).toBeTrue();
  });
});
