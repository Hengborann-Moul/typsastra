import type { EditorView } from "@codemirror/view";
import { relativeFilePath } from "../platform/paths";

export const EXPLORER_IMAGE_DRAG_TYPE = "application/x-typsastra-explorer-image";

export type ImageInsertionStyle = "image" | "figure";

export type ImageInsertionSnippet = {
  text: string;
  selectionOffset: number;
};

export type ClipboardImageData = {
  bytes: ArrayBuffer;
  mimeType: string;
};

export function explorerImageDragPath(dataTransfer: DataTransfer | null): string | null {
  const path = dataTransfer?.getData(EXPLORER_IMAGE_DRAG_TYPE).trim() ?? "";
  return path || null;
}

export function clipboardImageFiles(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  return Array.from(dataTransfer.items)
    .filter(item => item.kind === "file" && item.type.toLowerCase().startsWith("image/"))
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export async function readClipboardImageFiles(files: readonly File[]): Promise<ClipboardImageData[]> {
  return Promise.all(files.map(async file => ({
    bytes: await file.arrayBuffer(),
    mimeType: file.type,
  })));
}

export function moveImageDropCaret(
  view: EditorView,
  coords: { x: number; y: number },
): number | null {
  const position = view.posAtCoords(coords);
  if (position === null) return null;
  if (view.state.selection.main.head !== position) {
    view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
  }
  view.focus();
  return position;
}

export function relativeDocumentAssetPath(
  workspaceRoot: string,
  documentPath: string,
  assetPath: string,
): string | null {
  const relativeDocument = relativeFilePath(workspaceRoot, documentPath)?.replace(/\\/g, "/") ?? null;
  const relativeAsset = relativeFilePath(workspaceRoot, assetPath)?.replace(/\\/g, "/") ?? null;
  if (relativeDocument === null || relativeAsset === null || relativeAsset === "") return null;

  const documentParts = relativeDocument.split("/").filter(Boolean);
  const assetParts = relativeAsset.split("/").filter(Boolean);
  documentParts.pop();
  while (documentParts.length > 0 && assetParts.length > 0 && pathPartEquals(documentParts[0], assetParts[0], workspaceRoot)) {
    documentParts.shift();
    assetParts.shift();
  }
  return [...documentParts.map(() => ".."), ...assetParts].join("/");
}

export function imageInsertionSnippet(path: string, style: ImageInsertionStyle): ImageInsertionSnippet {
  const escapedPath = path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (style === "image") {
    const text = `#image("${escapedPath}")`;
    return { text, selectionOffset: text.length };
  }

  const prefix = `#figure(\n  image("${escapedPath}"),\n  caption: [`;
  const text = `${prefix}],\n)`;
  return { text, selectionOffset: prefix.length };
}

export function imageInsertionSnippets(
  paths: readonly string[],
  style: ImageInsertionStyle,
): ImageInsertionSnippet | null {
  const snippets = paths.map(path => imageInsertionSnippet(path, style));
  if (snippets.length === 0) return null;
  const text = snippets.map(snippet => snippet.text).join("\n");
  return {
    text,
    selectionOffset: style === "image" ? text.length : snippets[0].selectionOffset,
  };
}

function pathPartEquals(left: string, right: string, root: string): boolean {
  const windowsPath = /^[A-Za-z]:[\\/]/u.test(root) || root.startsWith("\\\\") || root.startsWith("//");
  return windowsPath ? left.toLowerCase() === right.toLowerCase() : left === right;
}
