export type TypstPackageReference = {
  namespace: "preview" | "local";
  name: string;
  version: string;
  spec: string;
};

export type TypstSourceLocation = {
  filePath: string;
  line: number;
  column: number;
};

export type TypstPackageImport = TypstSourceLocation & {
  package: TypstPackageReference;
};

export type PreviewCompilerFailure = {
  message: string;
  location: TypstSourceLocation | null;
  package: TypstPackageReference | null;
  packageCacheRoot: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rawErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const value = record(error);
  const message = typeof value?.message === "string" ? value.message : "";
  const data = value?.data;
  const detail = typeof data === "string"
    ? data
    : data === undefined
      ? ""
      : JSON.stringify(data, null, 2);
  if (message && detail && detail !== message) return `${message}\n\n${detail}`;
  if (message || detail) return message || detail;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function unwrapTinymistExportMessage(message: string): string {
  const clean = message.replace(/\u001b\[[0-9;]*m/g, "").trim();
  const marker = "document is not available for export:";
  const markerIndex = clean.indexOf(marker);
  if (markerIndex < 0) return clean;
  const wrapped = clean.slice(markerIndex + marker.length).trim();
  if (wrapped.startsWith('"') && wrapped.endsWith('"')) {
    try {
      const parsed = JSON.parse(wrapped);
      if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
    } catch {
      return wrapped.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
    }
  }
  return wrapped || clean;
}

export function parseTypstPackageReference(spec: string): TypstPackageReference | null {
  const match = /^@(preview|local)\/([^:/"']+):([^/"']+)$/.exec(spec.trim());
  if (!match) return null;
  return {
    namespace: match[1] as "preview" | "local",
    name: match[2],
    version: match[3],
    spec: `@${match[1]}/${match[2]}:${match[3]}`
  };
}

export function typstPackageImports(source: string, filePath: string): TypstPackageImport[] {
  const imports: TypstPackageImport[] = [];
  const expression = /\bimport\s+["'](@(?:preview|local)\/[^:"']+:[^"']+)["']/g;
  for (const match of source.matchAll(expression)) {
    const packageReference = parseTypstPackageReference(match[1]);
    if (!packageReference || match.index === undefined) continue;
    const prefix = source.slice(0, match.index);
    const lineStart = prefix.lastIndexOf("\n") + 1;
    imports.push({
      package: packageReference,
      filePath,
      line: prefix.split("\n").length,
      column: match.index - lineStart + 1
    });
  }
  return imports;
}

export function parsePreviewCompilerFailure(error: unknown): PreviewCompilerFailure {
  const message = unwrapTinymistExportMessage(rawErrorText(error));
  const locationMatch = /^[ \t]*[^\r\n]*?((?:[A-Za-z]:[\\/]|\/)[^\r\n]+):(\d+):(\d+)[ \t]*$/m.exec(message);
  const location = locationMatch
    ? {
        filePath: locationMatch[1].trim(),
        line: Number(locationMatch[2]),
        column: Number(locationMatch[3])
      }
    : null;
  const packageMatch = location?.filePath.match(
    /^(.*?[\\/]typst[\\/]packages)[\\/](preview|local)[\\/]([^\\/]+)[\\/]([^\\/]+)(?:[\\/]|$)/i
  ) ?? null;
  const packageReference = packageMatch
    ? parseTypstPackageReference(`@${packageMatch[2].toLowerCase()}/${packageMatch[3]}:${packageMatch[4]}`)
    : null;
  return {
    message,
    location,
    package: packageReference,
    packageCacheRoot: packageMatch?.[1] ?? null
  };
}

export function typstPackageEntrypoint(manifest: string): string | null {
  return /^\s*entrypoint\s*=\s*["']([^"']+)["']\s*$/m.exec(manifest)?.[1] ?? null;
}
