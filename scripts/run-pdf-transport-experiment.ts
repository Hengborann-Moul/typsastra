const mode = Bun.argv[2];
const profile = Bun.argv[3] ?? "dev";
if (mode !== "full" && mode !== "range") {
  console.error("Usage: bun scripts/run-pdf-transport-experiment.ts <full|range> [dev|release]");
  process.exit(1);
}
if (profile !== "dev" && profile !== "release") {
  console.error("Usage: bun scripts/run-pdf-transport-experiment.ts <full|range> [dev|release]");
  process.exit(1);
}

const environment = {
  ...process.env,
  VITE_PDF_TRANSPORT: mode
};
const command = profile === "release"
  ? [process.execPath, "run", "tauri", "build", "--no-bundle"]
  : [process.execPath, "run", "tauri", "dev"];
const child = Bun.spawn(command, {
  cwd: process.cwd(),
  env: environment,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit"
});

const exitCode = await child.exited;
if (exitCode !== 0 || profile !== "release") process.exit(exitCode);

const executableName = process.platform === "win32" ? "typsastra.exe" : "typsastra";
const executable = `${process.cwd()}/src-tauri/target/release/${executableName}`;
const release = Bun.spawn([executable], {
  cwd: process.cwd(),
  env: environment,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit"
});
process.exit(await release.exited);
