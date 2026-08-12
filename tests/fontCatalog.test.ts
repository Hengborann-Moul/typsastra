import { describe, expect, test } from "bun:test";
import {
  codeEditorFonts,
  codeEditorFontStack,
  configuredUnicodeEditorFamilies,
  detectUnicodeEditorFont,
  unicodeEditorFonts
} from "../src/editor/fontCatalog";

describe("editor font catalog", () => {
  test("applies a tab's Unicode font policy before installing its text", async () => {
    const source = await Bun.file(
      new URL("../src/editor/editorTabPresentationController.ts", import.meta.url),
    ).text();
    const presentation = source.indexOf("presentText(tab: EditorTab, path: string)");
    const fontUpdate = source.indexOf("this.deps.fontManager().prepareDocument(tab.content)", presentation);
    const documentDispatch = source.indexOf("editor.dispatch({", fontUpdate);
    expect(fontUpdate).toBeGreaterThan(presentation);
    expect(documentDispatch).toBeGreaterThan(fontUpdate);
    expect(source.slice(documentDispatch, source.indexOf("});", documentDispatch) + 3))
      .toContain("...(editorFontEffect ? [editorFontEffect] : [])");
  });

  test("defaults to bundled Fira Mono while accepting proportional editor fonts", () => {
    expect(codeEditorFonts[0].id).toBe("Fira Mono");
    expect(codeEditorFonts.every(font => font.fontFamily !== "MiSans Latin")).toBe(true);
    expect(codeEditorFontStack("fira-mono").startsWith('"Fira Mono"')).toBe(true);
    expect(codeEditorFontStack("MiSans Latin").startsWith('"MiSans Latin"')).toBe(true);
  });

  test("lists every installed family for the editor and propagates it through CodeMirror", async () => {
    const settings = await Bun.file(new URL("../src/settingsController.ts", import.meta.url)).text();
    const themes = await Bun.file(new URL("../src/editor/themes.ts", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/style.css", import.meta.url)).text();
    const hover = await Bun.file(new URL("../src/editor/hover.ts", import.meta.url)).text();

    expect(settings).toContain("...this.systemFonts.all");
    expect(settings).not.toContain("const codeFamilies = new Set(this.systemFonts.monospace)");
    expect(themes).toContain('fontFamily: "var(--editor-code-font) !important"');
    expect(themes).toContain('"--editor-indent-font": codeEditorFontStack("fira-mono")');
    expect(themes).toContain('fontFamily: "var(--editor-indent-font) !important"');
    expect(css).toMatch(/\.cm-panel\.cm-search input\[type="text"\][\s\S]*?font-family:\s*var\(--editor-code-font\)/);
    expect(hover).toContain('dom.style.fontFamily = "var(--editor-code-font)"');
  });

  test("recommends registered Unicode fonts for matching scripts", () => {
    expect(detectUnicodeEditorFont("\u1780\u17D2\u1798\u17C2\u179A")?.id).toBe("mi-sans-khmer");
    expect(detectUnicodeEditorFont("\u0395\u03BB\u03BB\u03B7\u03BD\u03B9\u03BA\u03AC")?.id).toBe("mi-sans-latin");
    expect(detectUnicodeEditorFont("\u041A\u0438\u0440\u0438\u043B\u043B\u0438\u0446\u0430")?.id).toBe("mi-sans-latin");
    expect(detectUnicodeEditorFont("\u0627\u0644\u0639\u0631\u0628\u064A\u0629")?.id).toBe("mi-sans-arabic");
    expect(detectUnicodeEditorFont("\u0E44\u0E17\u0E22")?.id).toBe("mi-sans-thai");
    expect(detectUnicodeEditorFont("\u4e2d\u6587")?.id).toBe("noto-sans-sc");
    expect(detectUnicodeEditorFont("fran\u00E7ais")).toBeNull();
    expect(unicodeEditorFonts.find(font => font.id === "mi-sans-khmer")?.bundled).toBe(false);
    expect(unicodeEditorFonts.find(font => font.id === "mi-sans-latin")?.bundled).toBe(true);
  });

  test("places an explicit Unicode fallback after the selected code font", () => {
    expect(codeEditorFontStack("Fira Mono", ["MiSans Khmer"]).startsWith('"Fira Mono", "MiSans Khmer"')).toBe(true);
  });

  test("prepares configured script fonts before the first character is entered", () => {
    const automatic = configuredUnicodeEditorFamilies("auto");
    expect(automatic).toContain("MiSans Khmer");
    expect(configuredUnicodeEditorFamilies("none", { "mi-sans-khmer": "Khmer OS" }))
      .toEqual(["Khmer OS"]);
  });

  test("keeps system complex-script fallbacks in the editor stack", () => {
    const stack = codeEditorFontStack("Fira Mono");
    expect(stack).toContain('"Noto Sans Khmer"');
    expect(stack).toContain('"Noto Sans"');
  });

  test("recommends Noto Sans when MiSans has no matching script family", () => {
    expect(detectUnicodeEditorFont("\u65E5\u672C\u8A9E\u30AB\u30CA")?.id).toBe("noto-sans-jp");
    expect(detectUnicodeEditorFont("\uD55C\uAE00")?.id).toBe("noto-sans-kr");
    expect(detectUnicodeEditorFont("\u05E2\u05D1\u05E8\u05D9\u05EA")?.id).toBe("noto-sans-hebrew");
  });
});
