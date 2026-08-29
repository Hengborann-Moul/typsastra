import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, type DragDropEvent } from "@tauri-apps/api/window";
import { join } from "@tauri-apps/api/path";
import { message } from "@tauri-apps/plugin-dialog";
import type { EditorView } from "@codemirror/view";
import type { AppDialogController } from "../ui/appDialog";
import { isSupportedImageReferencePath, isTypstDocumentPath } from "../platform/fileTypes";
import { fileNameFromPath, filePathKey, relativeFilePath } from "../platform/paths";
import {
  imageInsertionSnippet,
  moveImageDropCaret,
  relativeDocumentAssetPath,
  type ImageInsertionStyle,
} from "../editor/imageDrop";

export interface FileDropDependencies {
  editor(): EditorView;
  appDialog: AppDialogController;
  workspaceRootPath(): string | null;
  activeFilePath(): string | null;
  refreshWorkspaceExplorer(): Promise<void>;
  refreshImageExplorer(): Promise<void> | void;
}

type DropPoint = { x: number; y: number };
type ExplorerPointerDrag = {
  path: string;
  pointerId: number;
  start: DropPoint;
  active: boolean;
};

export class FileDropController {
  private scaleFactor = 1;
  private explorerPointerDrag: ExplorerPointerDrag | null = null;
  private suppressExplorerClickUntil = 0;

  public constructor(private readonly deps: FileDropDependencies) {}

  public initialize(): void {
    document.addEventListener("pointermove", event => this.handleExplorerPointerMove(event), true);
    document.addEventListener("pointerup", event => this.handleExplorerPointerUp(event), true);
    document.addEventListener("pointercancel", event => this.cancelExplorerPointerDrag(event.pointerId), true);
    document.addEventListener("click", event => {
      if (performance.now() >= this.suppressExplorerClickUntil) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    const appWindow = getCurrentWindow();
    void appWindow.scaleFactor().then(scaleFactor => {
      this.scaleFactor = scaleFactor || 1;
      return appWindow.onDragDropEvent(event => void this.handleNativeDragDrop(event.payload));
    }).catch(error => console.error("Failed to initialize file drag and drop:", error));
  }

  public insertExplorerImage(path: string, position: number, view: EditorView): void {
    void this.insertImage(path, position, view);
  }

  public startExplorerImageDrag(path: string, event: PointerEvent): void {
    this.explorerPointerDrag = {
      path,
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      active: false,
    };
  }

  private handleExplorerPointerMove(event: PointerEvent): void {
    const drag = this.explorerPointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      const distance = Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y);
      if (distance < 5) return;
      drag.active = true;
      document.body.classList.add("explorer-image-dragging");
    }
    event.preventDefault();
    this.showDropTarget(document.elementFromPoint(event.clientX, event.clientY), {
      x: event.clientX,
      y: event.clientY,
    }, true);
  }

  private handleExplorerPointerUp(event: PointerEvent): void {
    const drag = this.explorerPointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.explorerPointerDrag = null;
    document.body.classList.remove("explorer-image-dragging");
    this.clearDropTarget();
    if (!drag.active) return;

    event.preventDefault();
    event.stopPropagation();
    this.suppressExplorerClickUntil = performance.now() + 250;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target?.closest(".cm-editor")) return;
    const view = this.deps.editor();
    const position = moveImageDropCaret(view, { x: event.clientX, y: event.clientY });
    if (position !== null) this.insertExplorerImage(drag.path, position, view);
  }

  private cancelExplorerPointerDrag(pointerId: number): void {
    if (this.explorerPointerDrag?.pointerId !== pointerId) return;
    this.explorerPointerDrag = null;
    document.body.classList.remove("explorer-image-dragging");
    this.clearDropTarget();
  }

  private async handleNativeDragDrop(event: DragDropEvent): Promise<void> {
    if (event.type === "leave") {
      this.clearDropTarget();
      return;
    }

    const point = this.logicalPoint(event.position);
    const target = document.elementFromPoint(point.x, point.y);
    if (event.type === "enter" || event.type === "over") {
      this.showDropTarget(target, point, false);
      return;
    }

    this.clearDropTarget();
    if (!target || event.paths.length === 0) return;
    if (target.closest(".cm-editor")) {
      await this.dropExternalImageIntoEditor(event.paths, point);
      return;
    }

    const workspaceRoot = this.deps.workspaceRootPath();
    const destination = workspaceRoot
      ? explorerDropRelativeDirectory(workspaceRoot, target)
      : null;
    if (workspaceRoot !== null && destination !== null) {
      await this.importFilesIntoExplorer(workspaceRoot, destination, event.paths);
    }
  }

  private async dropExternalImageIntoEditor(paths: readonly string[], point: DropPoint): Promise<void> {
    const activeFilePath = this.deps.activeFilePath();
    if (!activeFilePath || !isTypstDocumentPath(activeFilePath)) {
      await message("Open a Typst document before dropping an image into the editor.", {
        title: "Typst document required",
        kind: "info",
      });
      return;
    }
    const images = paths.filter(isSupportedImageReferencePath);
    if (images.length === 0) {
      await message("Only supported image files can be dropped into a Typst editor.", {
        title: "Image required",
        kind: "info",
      });
      return;
    }
    if (images.length > 1) {
      await message("Drop one image at a time so Typsastra can place it at the intended editor position.", {
        title: "Multiple images selected",
        kind: "info",
      });
      return;
    }

    const view = this.deps.editor();
    const position = moveImageDropCaret(view, point) ?? view.state.selection.main.head;
    await this.insertImage(images[0], position, view);
  }

  private async importFilesIntoExplorer(
    workspaceRoot: string,
    destinationRelativeDirectory: string,
    sources: readonly string[],
  ): Promise<void> {
    const failures: string[] = [];
    let imported = 0;
    for (const sourcePath of sources) {
      try {
        await invoke<string>("import_workspace_file", {
          workspaceRootPath: workspaceRoot,
          sourcePath,
          destinationRelativeDirectory,
        });
        imported += 1;
      } catch (error) {
        failures.push(`${fileNameFromPath(sourcePath)}: ${String(error)}`);
      }
    }
    if (imported > 0) await this.refreshExplorers();
    if (failures.length > 0) {
      await message(failures.join("\n"), {
        title: imported > 0 ? "Some files were not imported" : "File import failed",
        kind: "error",
      });
    }
  }

  private async insertImage(sourcePath: string, position: number, view: EditorView): Promise<void> {
    const workspaceRoot = this.deps.workspaceRootPath();
    const documentPath = this.deps.activeFilePath();
    if (!workspaceRoot || !documentPath || !isTypstDocumentPath(documentPath)) return;
    if (!isSupportedImageReferencePath(sourcePath)) return;

    const originalDocumentPath = documentPath;
    let projectImagePath = sourcePath;
    if (relativeFilePath(workspaceRoot, sourcePath) === null) {
      const imagesDirectory = await join(workspaceRoot, "images");
      const imagesDirectoryExists = await invoke<boolean>("workspace_path_exists", { path: imagesDirectory })
        .catch(() => false);
      const action = await this.deps.appDialog.show({
        title: imagesDirectoryExists ? "Copy Image into Project" : "Create Images Folder",
        subtitle: fileNameFromPath(sourcePath),
        description: imagesDirectoryExists
          ? "Images outside the project must be included in the project folder. Copy this image into the project images folder?"
          : "Images outside the project must be included in the project folder. Create an images folder and copy this image into it?",
        actions: [
          { id: "cancel", label: "Cancel" },
          {
            id: "import",
            label: imagesDirectoryExists ? "Copy Image" : "Create Folder and Copy",
            primary: true,
          },
        ],
        cancelAction: "cancel",
      });
      if (action !== "import") return;
      try {
        projectImagePath = await invoke<string>("import_workspace_file", {
          workspaceRootPath: workspaceRoot,
          sourcePath,
          destinationRelativeDirectory: "images",
        });
        await this.refreshExplorers();
      } catch (error) {
        await message(String(error), { title: "Image import failed", kind: "error" });
        return;
      }
    }

    const relativePath = relativeDocumentAssetPath(workspaceRoot, documentPath, projectImagePath);
    if (!relativePath) return;
    const insertion = await this.chooseInsertionStyle(relativePath);
    if (!insertion) return;
    if (
      filePathKey(this.deps.activeFilePath() ?? "") !== filePathKey(originalDocumentPath)
      || this.deps.editor() !== view
      || position < 0
      || position > view.state.doc.length
    ) return;

    const snippet = imageInsertionSnippet(relativePath, insertion);
    view.dispatch({
      changes: { from: position, to: position, insert: snippet.text },
      selection: { anchor: position + snippet.selectionOffset },
      scrollIntoView: true,
      userEvent: "input.drop",
    });
    view.focus();
  }

  private async chooseInsertionStyle(relativePath: string): Promise<ImageInsertionStyle | null> {
    const action = await this.deps.appDialog.show({
      title: "Insert Image",
      subtitle: relativePath,
      description: "Insert a plain image, or surround it with a figure function and an editable caption?",
      actions: [
        { id: "cancel", label: "Cancel" },
        { id: "image", label: "Plain Image" },
        { id: "figure", label: "Figure with Caption", primary: true },
      ],
      cancelAction: "cancel",
    });
    return action === "image" || action === "figure" ? action : null;
  }

  private async refreshExplorers(): Promise<void> {
    await this.deps.refreshWorkspaceExplorer();
    await this.deps.refreshImageExplorer();
  }

  private logicalPoint(position: { x: number; y: number }): DropPoint {
    return { x: position.x / this.scaleFactor, y: position.y / this.scaleFactor };
  }

  private showDropTarget(target: Element | null, point: DropPoint, editorOnly: boolean): void {
    this.clearDropTarget();
    if (!target) return;
    const editor = target.closest(".cm-editor");
    if (editor) {
      editor.classList.add("file-drop-target");
      const activeFilePath = this.deps.activeFilePath();
      if (activeFilePath && isTypstDocumentPath(activeFilePath)) {
        moveImageDropCaret(this.deps.editor(), point);
      }
      return;
    }
    if (editorOnly) return;
    const explorer = target.closest("#workspace-explorer-tree");
    if (!explorer) return;
    const item = target.closest<HTMLElement>(".explorer-item-target");
    (item ?? explorer).classList.add("file-drop-target");
  }

  private clearDropTarget(): void {
    document.querySelectorAll(".file-drop-target").forEach(element => element.classList.remove("file-drop-target"));
  }
}

export function explorerDropRelativeDirectory(workspaceRoot: string, target: Element): string | null {
  const explorer = target.closest("#workspace-explorer-tree");
  if (!explorer) return null;
  const item = target.closest<HTMLElement>(".explorer-item-target");
  if (!item?.dataset.path) return "";
  return explorerDropRelativeDirectoryForEntry(
    workspaceRoot,
    item.dataset.path,
    item.dataset.isDir === "true",
  );
}

export function explorerDropRelativeDirectoryForEntry(
  workspaceRoot: string,
  entryPath: string,
  isDirectory: boolean,
): string | null {
  const relative = relativeFilePath(workspaceRoot, entryPath);
  if (relative === null) return null;
  if (isDirectory) return relative.replace(/\\/g, "/");
  const parts = relative.replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/");
}
