import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  analyzeUnicodeTextItems,
  parseUnicodeFixtureCases,
  type PdfTextItemGeometry,
  type UnicodeCaseResult
} from "./enhanced-unicode-validation-core";
import { normalizePdfLogicalTextContent } from "../src/preview/pdfLogicalText";

interface CompilerResult {
  name: "baseline" | "enhanced";
  executable: string;
  version: string;
  pdfPath: string;
  compileMs: number;
  pdfBytes: number;
  pages: number;
  cases: UnicodeCaseResult[];
}

const root = process.cwd();
const fixturePath = join(root, "tests", "fixtures", "enhanced-unicode", "unicode-selection.typ");
const outputDirectory = resolve(
  root,
  argument("--output-dir") ?? join("artifacts", "enhanced-unicode"),
);
const defaultEnhancedExecutable = resolve(
  root,
  "..",
  "typst-unicode-pdf",
  "target",
  "release",
  process.platform === "win32" ? "typst.exe" : "typst"
);

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const baselineExecutable = argument("--baseline") ?? process.env.TYPSASTRA_BASELINE_TYPST ?? "typst";
const enhancedExecutable = argument("--enhanced")
  ?? process.env.TYPSASTRA_ENHANCED_TYPST
  ?? defaultEnhancedExecutable;
const strict = process.argv.includes("--strict");

async function run(command: string[], capture = false): Promise<string> {
  const child = Bun.spawn(command, {
    stdout: capture ? "pipe" : "inherit",
    stderr: capture ? "pipe" : "inherit"
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    capture ? new Response(child.stdout).text() : Promise.resolve(""),
    capture ? new Response(child.stderr).text() : Promise.resolve("")
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed${stderr.trim() ? `:\n${stderr.trim()}` : "."}`);
  }
  return stdout.trim();
}

async function inspectPdf(
  name: CompilerResult["name"],
  executable: string,
  cases: ReturnType<typeof parseUnicodeFixtureCases>
): Promise<CompilerResult> {
  const pdfPath = join(outputDirectory, `${name}.pdf`);
  const startedAt = performance.now();
  await run([executable, "compile", fixturePath, pdfPath]);
  const compileMs = performance.now() - startedAt;
  const pdfBytes = (await Bun.file(pdfPath).arrayBuffer()).byteLength;
  const loadingTask = getDocument({ data: new Uint8Array(await Bun.file(pdfPath).arrayBuffer()) });
  const pdf = await loadingTask.promise;
  const items: PdfTextItemGeometry[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const pageView = [...page.view];
    const textContent = normalizePdfLogicalTextContent(await page.getTextContent({
      disableNormalization: true,
      preserveLogicalText: true
    }));
    for (const item of textContent.items) {
      if (!("str" in item)) continue;
      items.push({
        pageNo,
        str: item.str,
        width: item.width,
        height: item.height,
        transform: [...item.transform],
        pageView
      });
    }
  }
  await loadingTask.destroy();
  return {
    name,
    executable,
    version: await run([executable, "--version"], true),
    pdfPath,
    compileMs: Number(compileMs.toFixed(1)),
    pdfBytes,
    pages: pdf.numPages,
    cases: analyzeUnicodeTextItems(cases, items)
  };
}

function totals(result: CompilerResult) {
  return {
    exact: result.cases.filter(item => item.exactLogicalText).length,
    whitespaceInsensitive: result.cases.filter(item => item.whitespaceInsensitiveText).length,
    geometry: result.cases.filter(item => item.geometryFinite && item.geometryInsidePage).length,
    controls: result.cases.filter(item => item.unexpectedControlCharacters.length > 0).length,
    total: result.cases.length
  };
}

function resultTable(result: CompilerResult): string {
  return result.cases.map(item =>
    `| ${item.id} | ${item.exactLogicalText ? "pass" : "fail"} | ${item.whitespaceInsensitiveText ? "pass" : "fail"} | ${item.geometryFinite && item.geometryInsidePage ? "pass" : "fail"} | ${item.textItemCount} | ${item.unexpectedControlCharacters.join(", ") || "none"} |`
  ).join("\n");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const fixtureSource = await Bun.file(fixturePath).text();
const cases = parseUnicodeFixtureCases(fixtureSource);
if (cases.length === 0) throw new Error("The Enhanced Unicode fixture contains no EU-* cases.");

const baseline = await inspectPdf("baseline", baselineExecutable, cases);
const enhanced = await inspectPdf("enhanced", enhancedExecutable, cases);
const baselineTotals = totals(baseline);
const enhancedTotals = totals(enhanced);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  fixture: fixturePath,
  pdfJs: "6.2.108 + Typsastra preserveLogicalText patch",
  baseline,
  enhanced,
  summary: { baseline: baselineTotals, enhanced: enhancedTotals }
};
await writeFile(join(outputDirectory, "report.json"), JSON.stringify(report, null, 2));

const markdown = `# Enhanced Unicode Engine validation

Generated: ${report.generatedAt}

This report deliberately separates logical extraction from PDF selection geometry. Passing extraction does not prove that every viewer creates correct selection rectangles.

## Compiler comparison

| Compiler | Version | Compile | PDF | Exact text | Whitespace-insensitive | PDF.js geometry | Control-character failures |
|---|---|---:|---:|---:|---:|---:|---:|
| Baseline | ${baseline.version} | ${baseline.compileMs} ms | ${(baseline.pdfBytes / 1024).toFixed(1)} KiB | ${baselineTotals.exact}/${baselineTotals.total} | ${baselineTotals.whitespaceInsensitive}/${baselineTotals.total} | ${baselineTotals.geometry}/${baselineTotals.total} | ${baselineTotals.controls} |
| Enhanced | ${enhanced.version} | ${enhanced.compileMs} ms | ${(enhanced.pdfBytes / 1024).toFixed(1)} KiB | ${enhancedTotals.exact}/${enhancedTotals.total} | ${enhancedTotals.whitespaceInsensitive}/${enhancedTotals.total} | ${enhancedTotals.geometry}/${enhancedTotals.total} | ${enhancedTotals.controls} |

## Enhanced compiler cases

| Case | Exact logical text | Ignoring whitespace | Geometry | PDF.js items | Unexpected controls |
|---|---|---|---|---:|---|
${resultTable(enhanced)}

## Viewer compatibility matrix

The PDF.js row is generated automatically. Other viewers must be recorded manually because they use independent text-layout and selection engines.

| Viewer | Text extraction | Copy/paste | Search | Selection geometry | Status |
|---|---|---|---|---|---|
| Typsastra patched PDF.js 6.2.108 | ${enhancedTotals.exact}/${enhancedTotals.total} exact | automated extraction proxy | automated extraction proxy | ${enhancedTotals.geometry}/${enhancedTotals.total} bounded | automated |
| Adobe Acrobat Reader | pending | pending | pending | pending | manual |
| Microsoft Edge PDF viewer | pending | pending | pending | pending | manual |
| Google Chrome PDF viewer | pending | pending | pending | pending | manual |
| Firefox PDF viewer | pending | pending | pending | pending | manual |
| macOS Preview | pending | pending | pending | pending | manual |

## Interpretation

- **Exact logical text** compares the extracted Unicode sequence verbatim with the authored fixture line.
- **Ignoring whitespace** helps distinguish inferred-space geometry problems from lost or reordered Unicode.
- **Geometry** checks that PDF.js text items are finite and remain inside the PDF page bounds. It is not a substitute for manual drag-selection testing.
- Unexpected C0 controls indicate an invalid Unicode mapping and should be treated as an export failure.

Use \`bun run validate:enhanced-unicode -- --strict\` when all enhanced cases are expected to pass. The default command always writes the diagnostic report so incomplete engine work can be compared over time.
`;
await writeFile(join(outputDirectory, "report.md"), markdown);

console.log(`Enhanced Unicode validation complete: ${enhancedTotals.exact}/${enhancedTotals.total} exact; ${enhancedTotals.geometry}/${enhancedTotals.total} geometry checks passed.`);
console.log(`Report: ${join(outputDirectory, "report.md")}`);
if (strict && (enhancedTotals.exact !== enhancedTotals.total || enhancedTotals.geometry !== enhancedTotals.total || enhancedTotals.controls > 0)) {
  process.exitCode = 1;
}
