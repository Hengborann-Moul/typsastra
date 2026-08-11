import { invoke } from "@tauri-apps/api/core";
import {
  typstPackageEntrypoint,
  typstPackageImports,
  type PreviewCompilerFailure,
  type TypstPackageImport,
  type TypstPackageReference,
} from "../compiler/previewError";
import { fileNameFromPath, filePathKey } from "../platform/paths";
import type { LogConsoleController } from "./logConsoleController";

export type PreviewPackageFailureHint = {
  message: string;
  projectImport: TypstPackageImport;
};

export interface PreviewFailureControllerPort {
  mapToOriginalPath(path: string): string;
  sourceForPath(path: string): Promise<string>;
  isRenderCachePath(path: string): boolean;
}

/** Resolves package dependency failures and publishes user-facing compiler problems. */
export class PreviewFailureController {
  constructor(
    private readonly logConsole: LogConsoleController,
    private readonly port: PreviewFailureControllerPort,
  ) {}

  async packageFailureHint(
    failure: PreviewCompilerFailure,
    reachableSourcePaths: readonly string[],
  ): Promise<PreviewPackageFailureHint | null> {
    if (!failure.package || !failure.packageCacheRoot || reachableSourcePaths.length === 0) return null;

    const projectImports: TypstPackageImport[] = [];
    for (const path of reachableSourcePaths.slice(0, 128)) {
      const originalPath = this.port.mapToOriginalPath(path);
      const source = await this.port.sourceForPath(originalPath);
      projectImports.push(...typstPackageImports(source, originalPath));
    }

    const uniqueImports = projectImports.filter((entry, index, entries) =>
      entries.findIndex(candidate =>
        candidate.package.spec === entry.package.spec
        && filePathKey(candidate.filePath) === filePathKey(entry.filePath)
        && candidate.line === entry.line
      ) === index
    );
    for (const projectImport of uniqueImports) {
      const chain = await this.packageDependencyChain(
        projectImport.package,
        failure.package,
        failure.packageCacheRoot,
      );
      if (!chain) continue;
      const relation = chain.length === 1
        ? `${projectImport.package.spec} is the package that failed.`
        : `${projectImport.package.spec} loads ${chain.slice(1).map(entry => entry.spec).join(" → ")}.`;
      return {
        projectImport,
        message: `${relation}\nUpdate ${projectImport.package.spec} to a release compatible with the selected Typst version.`,
      };
    }
    return null;
  }

  publish(failure: PreviewCompilerFailure, packageHint: PreviewPackageFailureHint | null): void {
    const failureComesFromRenderMirror = failure.location !== null
      && this.port.isRenderCachePath(failure.location.filePath);
    if (!failureComesFromRenderMirror) {
      this.logConsole.appendLog({
        kind: "error",
        source: "compiler",
        message: failure.message,
        channel: "lsp",
        counted: true,
        filePath: failure.location?.filePath,
        fileName: failure.location ? fileNameFromPath(failure.location.filePath) : undefined,
        line: failure.location?.line,
        column: failure.location?.column,
      });
    }
    if (!packageHint) return;
    this.logConsole.appendLog({
      kind: "error",
      source: "package compatibility",
      message: packageHint.message,
      channel: "lsp",
      counted: true,
      filePath: packageHint.projectImport.filePath,
      fileName: fileNameFromPath(packageHint.projectImport.filePath),
      line: packageHint.projectImport.line,
      column: packageHint.projectImport.column,
    });
  }

  private async packageDependencyChain(
    root: TypstPackageReference,
    target: TypstPackageReference,
    packageCacheRoot: string,
  ): Promise<TypstPackageReference[] | null> {
    const targetSpec = target.spec.toLocaleLowerCase();
    const queue: TypstPackageReference[][] = [[root]];
    const visited = new Set<string>();
    while (queue.length > 0 && visited.size < 64) {
      const chain = queue.shift()!;
      const current = chain[chain.length - 1];
      const key = current.spec.toLocaleLowerCase();
      if (key === targetSpec) return chain;
      if (visited.has(key) || chain.length >= 5) continue;
      visited.add(key);

      const packageDirectory = `${packageCacheRoot}/${current.namespace}/${current.name}/${current.version}`;
      const manifest = await invoke<string>("read_workspace_file", {
        path: `${packageDirectory}/typst.toml`,
      }).catch(() => "");
      const entrypoint = typstPackageEntrypoint(manifest);
      if (!entrypoint) continue;
      const entrypointPath = `${packageDirectory}/${entrypoint}`;
      const packageSource = await invoke<string>("read_workspace_file", {
        path: entrypointPath,
      }).catch(() => "");
      for (const dependency of typstPackageImports(packageSource, entrypointPath)) {
        queue.push([...chain, dependency.package]);
      }
    }
    return null;
  }
}
