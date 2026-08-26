import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createEnhancedUnicodeReleaseManifest,
  type EnhancedUnicodeReleaseSpec,
} from "../scripts/enhanced-unicode-release-manifest";

function spec(): EnhancedUnicodeReleaseSpec {
  return {
    schemaVersion: 1,
    engine: {
      name: "Typsastra Enhanced Unicode Engine",
      version: "0.3.1",
      typstVersion: "0.15.1",
      typstRepository: "Sovichea/typst",
      typstCommit: "e".repeat(40),
      krillaRepository: "Sovichea/krilla",
      krillaCommit: "9".repeat(40),
      license: "Apache-2.0",
    },
    release: {
      repository: "Sovichea/typsastra",
      tag: "enhanced-unicode-v0.3.1",
      notes: "docs/notes.md",
    },
    targets: [
      {
        target: "example-target",
        archive: "typsastra-enhanced-unicode-v0.3.1-example-target.zip",
        executable: "typst",
      },
    ],
  };
}

describe("Enhanced Unicode release manifest", () => {
  test("records immutable asset identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "typsastra-engine-release-"));
    const archive = spec().targets[0].archive;
    await writeFile(join(directory, archive), "engine archive");
    const manifest = await createEnhancedUnicodeReleaseManifest(
      spec(),
      directory,
      "2026-08-20T00:00:00.000Z",
    );

    expect(manifest.generatedAt).toBe("2026-08-20T00:00:00.000Z");
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]).toMatchObject({
      target: "example-target",
      archive,
      executable: "typst",
      bytes: 14,
      sha256: "707748c22ceaddb5a1057403c94a835994a72bbebfbec8bca82c0beb00fa8313",
      downloadUrl: `https://github.com/Sovichea/typsastra/releases/download/enhanced-unicode-v0.3.1/${archive}`,
    });
  });

  test("rejects incomplete and mismatched releases", async () => {
    const directory = await mkdtemp(join(tmpdir(), "typsastra-engine-release-"));
    await expect(createEnhancedUnicodeReleaseManifest(spec(), directory)).rejects.toThrow("Missing release archive");

    const mismatched = spec();
    mismatched.release.tag = "enhanced-unicode-v0.3.0";
    await expect(createEnhancedUnicodeReleaseManifest(mismatched, directory)).rejects.toThrow("does not match");
  });
});
