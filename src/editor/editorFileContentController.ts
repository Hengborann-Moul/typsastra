import { invoke } from "@tauri-apps/api/core";
import { fileExtension, isBinaryImagePath, isSupportedInAppPath } from "../platform/fileTypes";
import { filePathKey } from "../platform/paths";
import type { EditorTab } from "./editorTab";
import type { EditorFoldRange } from "./folding";

export interface EditorFileContentDependencies {
  normalizeFoldRanges(value: unknown, docLength: number): EditorFoldRange[];
}

/** Owns lazy editor-file classification and content loading. */
export class EditorFileContentController {
  private readonly detectedPlainTextPaths = new Set<string>();
  private readonly classifiedUnknownPaths = new Set<string>();

  constructor(private readonly deps: EditorFileContentDependencies) {}

  isInternallySupportedPath(path: string): boolean {
    return isSupportedInAppPath(path) || this.detectedPlainTextPaths.has(filePathKey(path));
  }

  async classifyUnknownTextPath(path: string): Promise<boolean> {
    if (isSupportedInAppPath(path)) return true;
    const key = filePathKey(path);
    if (this.classifiedUnknownPaths.has(key)) {
      return this.detectedPlainTextPaths.has(key);
    }
    const isPlainText = await invoke<boolean>("is_probably_plain_text_file", { path })
      .catch(() => false);
    this.classifiedUnknownPaths.add(key);
    if (isPlainText) this.detectedPlainTextPaths.add(key);
    return isPlainText;
  }

  async loadTabContent(tab: EditorTab): Promise<void> {
    if (tab.contentLoaded) return;
    const contents = fileExtension(tab.path) === "pdf"
      ? ""
      : isBinaryImagePath(tab.path)
        ? await invoke<string>("read_workspace_file_as_base64", { path: tab.path })
        : normalizeEditorText(await invoke<string>("read_workspace_file", { path: tab.path }));
    tab.content = contents;
    tab.savedContent = contents;
    tab.contentLoaded = true;
    tab.undoHistory = undefined;
    tab.foldRanges = this.deps.normalizeFoldRanges(tab.foldRanges, contents.length);
  }
}

function normalizeEditorText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
