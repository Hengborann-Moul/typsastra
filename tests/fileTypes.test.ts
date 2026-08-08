import { describe, expect, test } from "bun:test";
import {
  fileExtension,
  isBinaryImagePath,
  isMarkdownDocumentPath,
  isSupportedInAppPath,
  isTypstDocumentPath,
} from "../src/platform/fileTypes";

describe("file types", () => {
  test("routes Typst, Markdown, and plain-text files to separate editor modes", async () => {
    const extensions = await Bun.file(new URL("../src/editor/extensions.ts", import.meta.url)).text();
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    expect(extensions).toContain("languageCompartment.of(typstLanguage)");
    expect(controller).toContain("private editorLanguageForPath(path: string): Extension");
    expect(controller).toContain("if (isMarkdownDocumentPath(path)) return this.markdownEditorLanguage");
    expect(controller).toContain("languageCompartment.reconfigure(this.editorLanguageForPath(path))");
  });

  test("recognizes supported editor and image formats case-insensitively", () => {
    expect(isSupportedInAppPath("C:\\docs\\main.TYP")).toBe(true);
    expect(isSupportedInAppPath("/docs/references.bib")).toBe(true);
    expect(isSupportedInAppPath("/docs/figure.PNG")).toBe(true);
    expect(isBinaryImagePath("/docs/figure.PNG")).toBe(true);
  });

  test("rejects formats that should be opened externally", () => {
    expect(isSupportedInAppPath("/docs/output.pdf")).toBe(true); // Now supported in-app
    expect(isSupportedInAppPath("/docs/archive.zip")).toBe(false);
    expect(isSupportedInAppPath("/docs/no-extension")).toBe(false);
  });

  test("probes unknown extensions before falling back to external opening", async () => {
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    expect(controller).toContain('invoke<boolean>("is_probably_plain_text_file", { path })');
    expect(controller).toContain("this.detectedPlainTextPaths.add(key)");
    expect(controller).toContain("return [];");
  });

  test("extracts only a file-name extension", () => {
    expect(fileExtension("C:\\folder.with.dot\\main.typ")).toBe("typ");
  });

  test("limits Typst language services to Typst documents", () => {
    expect(isTypstDocumentPath("C:\\docs\\main.TYP")).toBe(true);
    expect(isTypstDocumentPath("/docs/notes.md")).toBe(false);
    expect(isTypstDocumentPath("/docs/notes.txt")).toBe(false);
  });

  test("recognizes Markdown documents without treating them as Typst", () => {
    expect(isMarkdownDocumentPath("C:\\docs\\README.MD")).toBe(true);
    expect(isMarkdownDocumentPath("/docs/guide.markdown")).toBe(true);
    expect(isMarkdownDocumentPath("/docs/main.typ")).toBe(false);
  });
});
