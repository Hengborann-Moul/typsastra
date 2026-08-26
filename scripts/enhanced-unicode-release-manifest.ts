import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export interface EnhancedUnicodeReleaseSpec {
  schemaVersion: number;
  engine: {
    name: string;
    version: string;
    typstVersion: string;
    typstRepository: string;
    typstCommit: string;
    krillaRepository: string;
    krillaCommit: string;
    license: string;
  };
  release: {
    repository: string;
    tag: string;
    notes: string;
  };
  targets: Array<{
    target: string;
    archive: string;
    executable: string;
  }>;
}

export interface EnhancedUnicodeReleaseManifest extends EnhancedUnicodeReleaseSpec {
  generatedAt: string;
  assets: Array<{
    target: string;
    archive: string;
    executable: string;
    bytes: number;
    sha256: string;
    downloadUrl: string;
  }>;
}

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const stream = Bun.file(path).stream();
  for await (const chunk of stream) hasher.update(chunk);
  return hasher.digest("hex");
}

function assertReleaseSpec(spec: EnhancedUnicodeReleaseSpec): void {
  if (spec.schemaVersion !== 1) throw new Error(`Unsupported release schema ${spec.schemaVersion}.`);
  if (!/^\d+\.\d+\.\d+$/.test(spec.engine.version)) {
    throw new Error(`Invalid engine version ${JSON.stringify(spec.engine.version)}.`);
  }
  if (spec.release.tag !== `enhanced-unicode-v${spec.engine.version}`) {
    throw new Error("The release tag does not match the engine version.");
  }
  if (!/^[0-9a-f]{40}$/u.test(spec.engine.typstCommit)
    || !/^[0-9a-f]{40}$/u.test(spec.engine.krillaCommit)) {
    throw new Error("Engine source revisions must be full 40-character Git commit hashes.");
  }
  if (spec.targets.length === 0) throw new Error("The release defines no build targets.");
  const archives = new Set<string>();
  const targets = new Set<string>();
  for (const target of spec.targets) {
    if (archives.has(target.archive) || targets.has(target.target)) {
      throw new Error(`Duplicate release target or archive for ${target.target}.`);
    }
    archives.add(target.archive);
    targets.add(target.target);
  }
}

export async function createEnhancedUnicodeReleaseManifest(
  spec: EnhancedUnicodeReleaseSpec,
  assetsDirectory: string,
  generatedAt = new Date().toISOString(),
): Promise<EnhancedUnicodeReleaseManifest> {
  assertReleaseSpec(spec);
  const files = new Set(await readdir(assetsDirectory));
  const expected = new Set(spec.targets.map(target => target.archive));
  const unexpectedArchives = [...files]
    .filter(file => file.startsWith("typsastra-enhanced-unicode-") && file.endsWith(".zip"))
    .filter(file => !expected.has(file));
  if (unexpectedArchives.length > 0) {
    throw new Error(`Unexpected engine archive(s): ${unexpectedArchives.join(", ")}.`);
  }

  const assets = [];
  for (const target of spec.targets) {
    if (!files.has(target.archive)) throw new Error(`Missing release archive ${target.archive}.`);
    const path = join(assetsDirectory, target.archive);
    const file = Bun.file(path);
    const bytes = file.size;
    if (bytes <= 0) throw new Error(`Release archive ${target.archive} is empty.`);
    assets.push({
      ...target,
      bytes,
      sha256: await sha256(path),
      downloadUrl: `https://github.com/${spec.release.repository}/releases/download/${spec.release.tag}/${target.archive}`,
    });
  }

  return { ...spec, generatedAt, assets };
}

async function main(): Promise<void> {
  const specPath = resolve(process.argv[2] ?? "toolchains/enhanced-unicode/release-v0.3.0.json");
  const assetsDirectory = resolve(process.argv[3] ?? "release-assets");
  const outputPath = resolve(process.argv[4] ?? join(assetsDirectory, "enhanced-unicode-manifest.json"));
  const spec = await Bun.file(specPath).json() as EnhancedUnicodeReleaseSpec;
  const manifest = await createEnhancedUnicodeReleaseManifest(spec, assetsDirectory);
  await Bun.write(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${basename(outputPath)} for ${manifest.assets.length} platform assets.`);
}

if (import.meta.main) await main();
