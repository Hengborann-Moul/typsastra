import { invoke } from "@tauri-apps/api/core";
import { message, save } from "@tauri-apps/plugin-dialog";
import type { LspStatus } from "../compiler/lsp";
import { filePathKey, relativeFilePath } from "../platform/paths";
import {
  prepareRenderProjectWithCopyGuard,
  RenderCacheCopyCancelled,
} from "../preview/renderCacheCopyGuard";

export type ExportableEditorTab = {
  path: string;
  content: string;
  contentLoaded: boolean;
  isDirty: boolean;
};

type ProjectExportDependencies = {
  activeFilePath: () => string | null;
  activeContents: () => string;
  previewStandalone: () => boolean;
  previewRootPath: () => string | null;
  previewMainPath: () => string | null;
  workspaceRootPath: () => string | null;
  cacheRootPath: () => string | null;
  mapToOriginalPath: (path: string) => string;
  openTabs: () => readonly ExportableEditorTab[];
  khmerRenderPreparationEnabled: () => boolean;
  enhancedUnicodeEnginePath: () => string | null;
  setLspStatus: (status: LspStatus) => void;
};

export class ProjectExportController {
  private busy = false;

  constructor(private readonly deps: ProjectExportDependencies) {}

  get isBusy(): boolean {
    return this.busy;
  }

  async exportPdf(): Promise<void> {
    const activeFilePath = this.deps.activeFilePath();
    if (!activeFilePath) return;

    const content = this.deps.activeContents();
    this.busy = true;
    try {
      const rootPath = this.deps.previewStandalone()
        ? (this.deps.previewRootPath() ?? activeFilePath)
        : (this.deps.previewMainPath() ?? this.deps.previewRootPath() ?? activeFilePath);

      const defaultPdfPath = (this.deps.previewStandalone()
        ? activeFilePath
        : (this.deps.previewMainPath() ?? activeFilePath)).replace(/\.typ$/i, ".pdf");
      const exportPdfPath = await save({
        title: "Export PDF",
        defaultPath: defaultPdfPath,
        filters: [{ name: "PDF Document", extensions: ["pdf"] }]
      });
      if (!exportPdfPath) {
        this.deps.setLspStatus({ kind: "preview-ready", message: "PDF export cancelled" });
        return;
      }

      const enhancedUnicodeEnginePath = this.deps.enhancedUnicodeEnginePath();
      this.deps.setLspStatus({
        kind: "running",
        message: enhancedUnicodeEnginePath
          ? "Exporting PDF with Enhanced Unicode Engine..."
          : "Exporting PDF...",
      });
      let targetFilePath = rootPath;
      let targetContent = "";
      if (filePathKey(targetFilePath) === filePathKey(activeFilePath)) {
        targetContent = content;
      } else {
        targetContent = await invoke<string>("read_workspace_file", { path: targetFilePath }).catch(() => "");
      }

      const cacheRoot = this.deps.cacheRootPath();
      const workspaceRootPath = this.deps.workspaceRootPath();
      if (cacheRoot && workspaceRootPath) {
        const originalRootPath = this.deps.mapToOriginalPath(rootPath);
        const originalActivePath = this.deps.mapToOriginalPath(activeFilePath);
        const options = {
          enableKhmerZws: this.deps.khmerRenderPreparationEnabled(),
          projectRoot: workspaceRootPath,
          entryFile: originalRootPath,
          cacheRoot,
          generateSourceMap: false,
          // User-facing export must never compile Draft Preview placeholders.
          previewContentMode: "normal"
        };

        const result = await prepareRenderProjectWithCopyGuard<{ generatedEntryFile: string }>(options);
        const tabsToOverlay = this.deps.openTabs()
          .filter(tab => tab.contentLoaded)
          .filter(tab => tab.path.toLowerCase().endsWith(".typ"))
          .filter(tab => relativeFilePath(workspaceRootPath, this.deps.mapToOriginalPath(tab.path)) !== null);

        for (const tab of tabsToOverlay) {
          const originalTabPath = this.deps.mapToOriginalPath(tab.path);
          const sourceCode = filePathKey(originalTabPath) === filePathKey(originalActivePath)
            ? content
            : tab.content;
          await invoke("prepare_render_file", {
            options,
            filePath: originalTabPath,
            sourceCode
          });
        }

        targetFilePath = result.generatedEntryFile;
        targetContent = await invoke<string>("read_workspace_file", { path: targetFilePath }).catch(() => "");
      }

      const pdfPath = await invoke<string>("compile_typst_document", {
        sourceCode: targetContent,
        filePath: targetFilePath,
        compilerPath: enhancedUnicodeEnginePath,
      });
      await invoke("copy_workspace_file", { source: pdfPath, dest: exportPdfPath });
      await invoke("move_to_trash", { path: pdfPath });
      this.deps.setLspStatus({ kind: "preview-ready", message: `Exported to ${exportPdfPath}` });
    } catch (error) {
      if (error instanceof RenderCacheCopyCancelled) {
        this.deps.setLspStatus({ kind: "preview-ready", message: "PDF export cancelled" });
        return;
      }
      this.deps.setLspStatus({ kind: "error", message: `Export failed: ${error}` });
    } finally {
      this.busy = false;
    }
  }

  async exportProjectArchive(): Promise<void> {
    const workspaceRootPath = this.deps.workspaceRootPath();
    if (!workspaceRootPath) {
      alert("Please open a project first.");
      return;
    }
    if (this.deps.openTabs().some(tab => tab.isDirty)) {
      await message("Save all modified files before exporting so the archive matches the editor.", {
        title: "Unsaved Files",
        kind: "warning"
      });
      return;
    }

    const activeFilePath = this.deps.activeFilePath();
    const mainFilePath = this.deps.previewMainPath() ?? (
      activeFilePath?.toLowerCase().endsWith(".typ") ? activeFilePath : null
    );
    if (!mainFilePath) {
      await message("Set or open the project's main Typst file before exporting a version-bound project.", {
        title: "Main File Required",
        kind: "warning"
      });
      return;
    }

    this.busy = true;
    try {
      const folderName = workspaceRootPath.split(/[/\\]/).pop() || "workspace";
      const selected = await save({
        filters: [{ name: "Typsastra Project", extensions: ["typsastra"] }],
        defaultPath: `${folderName}.typsastra`
      });
      if (selected) {
        this.deps.setLspStatus({ kind: "running", message: "Exporting Typsastra project..." });
        await invoke("export_typsastra_project", {
          workspacePath: workspaceRootPath,
          archivePath: selected,
          mainFilePath
        });
        this.deps.setLspStatus({
          kind: "preview-ready",
          message: `Typsastra project exported to ${selected}. Font files were not included.`
        });
      }
    } catch (error) {
      this.deps.setLspStatus({ kind: "error", message: `Project export failed: ${error}` });
      await message(String(error), { title: "Typsastra Project Export Failed", kind: "error" });
    } finally {
      this.busy = false;
    }
  }

  async exportSourceZip(): Promise<void> {
    const workspaceRootPath = this.deps.workspaceRootPath();
    if (!workspaceRootPath) {
      alert("Please open a project first.");
      return;
    }
    if (this.deps.openTabs().some(tab => tab.isDirty)) {
      await message("Save all modified files before exporting so the ZIP matches the editor.", {
        title: "Unsaved Files",
        kind: "warning"
      });
      return;
    }

    this.busy = true;
    try {
      const folderName = workspaceRootPath.split(/[/\\]/).pop() || "workspace";
      const selected = await save({
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
        defaultPath: `${folderName}.zip`
      });
      if (selected) {
        this.deps.setLspStatus({ kind: "running", message: "Exporting source ZIP..." });
        await invoke("export_source_zip", {
          workspacePath: workspaceRootPath,
          zipPath: selected
        });
        this.deps.setLspStatus({
          kind: "preview-ready",
          message: `Source ZIP exported to ${selected}. Font files were not included.`
        });
      }
    } catch (error) {
      this.deps.setLspStatus({ kind: "error", message: `Source ZIP export failed: ${error}` });
      await message(String(error), { title: "Source ZIP Export Failed", kind: "error" });
    } finally {
      this.busy = false;
    }
  }
}
