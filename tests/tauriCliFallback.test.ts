import { describe, expect, test } from "bun:test";
import {
  installedCargoTauriVersion,
  isBundledCliFailure,
} from "../scripts/run-tauri-with-fallback";

describe("Tauri CLI fallback", () => {
  test("recognizes native CLI crashes", () => {
    expect(isBundledCliFailure({ exitCode: 139, output: "" })).toBe(true);
    expect(isBundledCliFailure({ exitCode: 1, output: "Segmentation fault (core dumped)" })).toBe(true);
    expect(isBundledCliFailure({ exitCode: 1, output: "Exec format error" })).toBe(true);
  });

  test("does not retry ordinary build failures or interruption", () => {
    expect(isBundledCliFailure({ exitCode: 1, output: "error: could not compile typsastra" })).toBe(false);
    expect(isBundledCliFailure({ exitCode: 130, output: "" })).toBe(false);
  });

  test("reads the installed Rust CLI version", () => {
    expect(installedCargoTauriVersion("tauri-cli 2.11.3")).toBe("2.11.3");
    expect(installedCargoTauriVersion("error: no such command: tauri")).toBeNull();
  });
});
