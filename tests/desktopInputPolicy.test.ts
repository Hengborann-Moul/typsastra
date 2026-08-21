import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { desktopInputAttributes } from "../src/ui/desktopInputPolicy";

const root = join(import.meta.dir, "..");

describe("desktop input policy", () => {
  test("disables browser text services for every text-like application input", () => {
    expect(desktopInputAttributes()).toEqual({
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false"
    });

    const source = readFileSync(join(root, "src", "ui", "desktopInputPolicy.ts"), "utf8");
    expect(source).toContain('input[type="text"]');
    expect(source).toContain('input[type="search"]');
    expect(source).toContain('input[type="number"]');
    expect(source).toContain('"textarea"');
    expect(source).toContain("MutationObserver");
    expect(source).toContain("installGraphemeTextControl");
  });

  test("applies the policy before Typsastra starts and declares it on page navigation", () => {
    const main = readFileSync(join(root, "src", "main.ts"), "utf8");
    const html = readFileSync(join(root, "index.html"), "utf8");
    const pageInputStart = html.indexOf('id="preview-page-input"');
    const pageInputEnd = html.indexOf("/>", pageInputStart);
    const pageInput = html.slice(pageInputStart, pageInputEnd);

    expect(main.indexOf("initializeDesktopInputPolicy()"))
      .toBeLessThan(main.indexOf("new TypsastraWorkspaceController()"));
    expect(pageInput).toContain('autocomplete="off"');
    expect(pageInput).toContain('autocorrect="off"');
    expect(pageInput).toContain('autocapitalize="off"');
    expect(pageInput).toContain('spellcheck="false"');
  });

  test("applies the same grapheme policy inside the standalone PDF document", () => {
    const previewFrame = readFileSync(join(root, "src", "preview", "previewFrame.ts"), "utf8");

    expect(previewFrame).toContain("applyDesktopInputPolicy(doc)");
  });
});
