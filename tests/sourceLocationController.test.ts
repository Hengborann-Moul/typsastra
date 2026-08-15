import { describe, expect, test } from "bun:test";
import { SourceLocationController } from "../src/navigation/sourceLocationController";

describe("source location cache mapping", () => {
  test("recognizes Rust-escaped mirror paths in Unicode workspaces", () => {
    const khmer = String.fromCodePoint(0x1781, 0x17d2, 0x1798, 0x17c2, 0x179a);
    const workspaceRoot = `C:\\Projects\\${khmer} DJI Matrice 4T`;
    const cacheRoot = "C:\\Users\\Tester\\AppData\\Local\\com.typsastra.editor\\workspace-cache\\0123456789abcdef";
    const controller = new SourceLocationController({
      workspaceRootPath: () => workspaceRoot,
      cacheRootPath: () => cacheRoot,
      activeFilePath: () => null,
      editor: () => { throw new Error("unused"); },
      lspClient: () => undefined,
      loadFile: async () => {},
      activeTabContentLoaded: () => false,
      generatedPreviewText: async () => "",
    });
    const escapedCachePath = `${cacheRoot}\\render\\03_sources\\lib.typ`;

    expect(controller.isRenderCachePath(escapedCachePath)).toBe(true);
    expect(controller.mapToOriginalPath(escapedCachePath)).toBe(
      `${workspaceRoot}/03_sources/lib.typ`,
    );
  });
});
