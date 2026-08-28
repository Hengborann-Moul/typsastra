import { describe, expect, test } from "bun:test";
import { LatestRequestGuard } from "../src/workspace/latestRequestGuard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("latest asynchronous request guard", () => {
  test("prevents an older same-file read from committing after a newer read", async () => {
    const guard = new LatestRequestGuard<string>();
    const older = guard.begin("main.typ");
    const newer = guard.begin("main.typ");
    const olderRead = deferred<string>();
    const newerRead = deferred<string>();
    let buffer = "initial";

    const commit = async (token: typeof older, read: Promise<string>) => {
      const contents = await read;
      if (guard.isCurrent(token)) buffer = contents;
    };
    const olderCommit = commit(older, olderRead.promise);
    const newerCommit = commit(newer, newerRead.promise);

    newerRead.resolve("latest");
    await newerCommit;
    olderRead.resolve("stale");
    await olderCommit;

    expect(buffer).toBe("latest");
  });

  test("tracks rapid updates independently across multiple files", () => {
    const guard = new LatestRequestGuard<string>();
    const mainOlder = guard.begin("main.typ");
    const chapter = guard.begin("chapter.typ");
    const mainLatest = guard.begin("main.typ");

    expect(guard.isCurrent(mainOlder)).toBe(false);
    expect(guard.isCurrent(mainLatest)).toBe(true);
    expect(guard.isCurrent(chapter)).toBe(true);
  });

  test("invalidates in-flight preview preparation before it can commit", () => {
    const guard = new LatestRequestGuard<"preview">();
    const preparing = guard.begin("preview");

    guard.invalidate("preview");

    expect(guard.isCurrent(preparing)).toBe(false);
  });

  test("guards disk reload, lazy loading, and preview preparation commit points", async () => {
    const reload = await Bun.file(new URL(
      "../src/workspace/externalFileReloadController.ts",
      import.meta.url,
    )).text();
    const lazyLoad = await Bun.file(new URL(
      "../src/editor/editorFileContentController.ts",
      import.meta.url,
    )).text();
    const preview = await Bun.file(new URL(
      "../src/preview/previewContentController.ts",
      import.meta.url,
    )).text();

    expect(reload).toContain("const request = this.reloadRequests.begin(pathKey);");
    expect(reload).toContain("if (!isCurrent()) continue;");
    expect(reload).toContain("this.deps.invalidateLazyLoad(path);");
    expect(lazyLoad).toContain("if (!this.loadRequests.isCurrent(request)) continue;");
    expect(preview).toContain('const request = this.refreshRequests.begin("preview");');
    expect(preview.match(/if \(!isCurrent\(\)\) return;/g)?.length).toBeGreaterThanOrEqual(5);
  });
});
