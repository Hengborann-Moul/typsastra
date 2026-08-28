import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildPdfiumTextRuns, type PdfiumPageText } from "../src/preview/pdfiumDocument";
import { parseUnicodeFixtureCases } from "./enhanced-unicode-validation-core";

const root = process.cwd();
const fixturePath = join(root, "tests", "fixtures", "enhanced-unicode", "unicode-selection.typ");
const outputDirectory = resolve(root, argument("--output-dir") ?? join("artifacts", "pdfium-unicode"));
const enhancedExecutable = resolve(
  argument("--enhanced")
    ?? process.env.TYPSASTRA_ENHANCED_TYPST
    ?? join(root, "..", "typst-unicode-pdf", "target", "release", process.platform === "win32" ? "typst.exe" : "typst"),
);

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function run(command: string[]): Promise<string> {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed${stderr.trim() ? `:\n${stderr.trim()}` : "."}`);
  }
  return stdout.trim();
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const pdfPath = join(outputDirectory, "enhanced-v0.4.0.pdf");
await run([enhancedExecutable, "compile", fixturePath, pdfPath]);
const version = await run([enhancedExecutable, "--version"]);
const dump = await run([
  "cargo",
  "run",
  "--quiet",
  "--manifest-path",
  join(root, "src-tauri", "Cargo.toml"),
  "--example",
  "pdfium_text_dump",
  "--",
  pdfPath,
]);
const pages = JSON.parse(dump) as PdfiumPageText[];
const logicalText = pages
  .flatMap(page => buildPdfiumTextRuns(page))
  .map(run => `${run.text}${run.hasEOL ? "\n" : ""}`)
  .join("");
const cases = parseUnicodeFixtureCases(await Bun.file(fixturePath).text());
const reconstructedLines = logicalText.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
const results = cases.map(fixtureCase => {
  const extracted = reconstructedLines.find(line => line.startsWith(`${fixtureCase.id}:`)) ?? "";
  return {
    id: fixtureCase.id,
    exact: extracted === fixtureCase.expected,
    expected: fixtureCase.expected,
    extracted,
  };
});
const exact = results.filter(result => result.exact).length;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  engine: { executable: enhancedExecutable, version },
  pdfium: "pdfium-bundled 0.1.1",
  adapter: "buildPdfiumTextRuns",
  fixture: fixturePath,
  exact,
  total: results.length,
  results,
};
await writeFile(join(outputDirectory, "report.json"), JSON.stringify(report, null, 2));
await writeFile(
  join(outputDirectory, "report.md"),
  `# PDFium Unicode validation\n\nGenerated: ${report.generatedAt}\n\n` +
  `- Engine: ${version}\n- PDFium: ${report.pdfium}\n- Exact logical text: ${exact}/${results.length}\n\n` +
  `| Case | Exact |\n|---|---|\n${results.map(result => `| ${result.id} | ${result.exact ? "pass" : "fail"} |`).join("\n")}\n`,
);
console.log(`PDFium Unicode validation complete: ${exact}/${results.length} exact.`);
console.log(`Report: ${join(outputDirectory, "report.md")}`);
if (exact !== results.length) process.exitCode = 1;
