import { invoke } from "@tauri-apps/api/core";
import type { DocumentOutlineController } from "../outline/documentOutline";
import { filePathKey } from "../platform/paths";
import { documentScriptsForPreviewContext } from "../preview/previewPolicy";
import { parseDocumentScripts, type DocumentTypography } from "./documentTypography";
import type { EditorTab } from "./editorTab";
import type { DocumentLanguageService } from "./languageScopes";
import type { SpellcheckController } from "./spellcheck";

export interface DocumentLanguageDependencies {
  languageService(): DocumentLanguageService;
  spellcheck(): SpellcheckController;
  outline(): DocumentOutlineController;
  activeFilePath(): string | null;
  pinnedMainFilePath(): string | null;
  previewImported(): boolean;
  isPinnedMainFile(path: string): boolean;
  editorText(): string;
  workspaceRootPath(): string | null;
  activeTab(): EditorTab | null;
  editorCursorPosition(): number;
}

/** Owns document-script language scope and debounced outline updates. */
export class DocumentLanguageController {
  private mainDocumentScriptsValue: DocumentTypography["fonts"] = [];
  private outlineUpdateTimer: number | null = null;
  private outlineUpdateGeneration = 0;

  constructor(private readonly deps: DocumentLanguageDependencies) {}

  get mainDocumentScripts(): DocumentTypography["fonts"] {
    return this.mainDocumentScriptsValue;
  }

  set mainDocumentScripts(value: DocumentTypography["fonts"]) {
    this.mainDocumentScriptsValue = value;
  }

  configure(text: string): void {
    const activeEntries = parseDocumentScripts(text);
    const pinnedMainFilePath = this.deps.pinnedMainFilePath();
    const activeFilePath = this.deps.activeFilePath();
    const activeOwnsDocumentConfiguration = !pinnedMainFilePath
      || (activeFilePath !== null && this.deps.isPinnedMainFile(activeFilePath));
    if (activeOwnsDocumentConfiguration) this.mainDocumentScriptsValue = activeEntries;
    const entries = documentScriptsForPreviewContext(
      activeFilePath,
      pinnedMainFilePath,
      this.deps.previewImported(),
      activeEntries,
      this.mainDocumentScriptsValue,
    );
    this.deps.languageService().configure(entries);
    this.deps.spellcheck().setDocumentScripts(entries);
  }

  activate(path: string | null): void {
    this.configure(path ? this.deps.editorText() : "");
    this.deps.spellcheck().activateDocument(path ? filePathKey(path) : "");
  }

  scheduleOutlineUpdate(path: string, delay = 180): void {
    if (this.outlineUpdateTimer !== null) {
      window.clearTimeout(this.outlineUpdateTimer);
    }
    const generation = ++this.outlineUpdateGeneration;
    this.outlineUpdateTimer = window.setTimeout(() => {
      this.outlineUpdateTimer = null;
      const activeTab = this.deps.activeTab();
      if (
        generation !== this.outlineUpdateGeneration
        || !activeTab
        || filePathKey(activeTab.path) !== filePathKey(path)
      ) return;
      void this.deps.outline().update(
        path,
        activeTab.content,
        this.deps.workspaceRootPath() || "",
        candidatePath => this.readWorkspaceFile(candidatePath),
      );
    }, delay);
  }


  updateOutlineNow(path: string, contents: string): void {
    void this.deps.outline().update(
      path,
      contents,
      this.deps.workspaceRootPath() || "",
      candidatePath => this.readWorkspaceFile(candidatePath),
    );
    this.deps.outline().setCursorPosition(
      this.deps.editorCursorPosition(),
      this.deps.activeFilePath(),
    );
  }

  clearOutline(): void {
    this.cancelOutlineUpdate();
    this.deps.outline().clear();
  }

  cancelOutlineUpdate(): void {
    this.outlineUpdateGeneration += 1;
    if (this.outlineUpdateTimer !== null) {
      window.clearTimeout(this.outlineUpdateTimer);
      this.outlineUpdateTimer = null;
    }
  }


  private async readWorkspaceFile(path: string): Promise<string | null> {
    try {
      return await invoke<string>("read_workspace_file", { path });
    } catch {
      return null;
    }
  }
}
