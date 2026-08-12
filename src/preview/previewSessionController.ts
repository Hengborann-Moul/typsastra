import { invoke } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import type { EditorTab, PreviewSessionState } from "../editor/editorTab";
import { fileNameFromPath, filePathKey, relativeFilePath } from "../platform/paths";
import type { PreviewRenderMode } from "../settings";
import {
  findLocalTemplateApplication,
  templatePreviewSource,
} from "../editor/templateTypography";
import {
  previewRefreshStyle,
  previewSessionIdentity,
  researchDocumentIdentity,
  type PreviewTarget,
} from "./previewPolicy";

export interface PreviewSessionDependencies {
  workspaceRootPath(): string | null;
  previewRenderMode(): PreviewRenderMode;
  readWorkspaceText(path: string): Promise<string>;
  logWarning(message: string): void;
}

/** Owns active preview-session identity and template-aware standalone preparation. */
export class PreviewSessionController {
  private session: PreviewSessionState = {
    previewRootPath: null,
    previewMainPath: null,
    previewTaskId: null,
    previewSessionKey: null,
    previewImported: false,
    previewStandalone: true,
    previewDisabled: false,
  };

  constructor(private readonly deps: PreviewSessionDependencies) {}

  get rootPath(): string | null { return this.session.previewRootPath; }
  set rootPath(value: string | null) { this.session.previewRootPath = value; }
  get mainPath(): string | null { return this.session.previewMainPath; }
  set mainPath(value: string | null) { this.session.previewMainPath = value; }
  get taskId(): string | null { return this.session.previewTaskId; }
  set taskId(value: string | null) { this.session.previewTaskId = value; }
  get sessionKey(): string | null { return this.session.previewSessionKey; }
  set sessionKey(value: string | null) { this.session.previewSessionKey = value; }
  get imported(): boolean { return this.session.previewImported; }
  set imported(value: boolean) { this.session.previewImported = value; }
  get standalone(): boolean { return this.session.previewStandalone; }
  set standalone(value: boolean) { this.session.previewStandalone = value; }
  get disabled(): boolean { return this.session.previewDisabled; }
  set disabled(value: boolean) { this.session.previewDisabled = value; }

  reset(): void {
    this.session = {
      previewRootPath: null,
      previewMainPath: null,
      previewTaskId: null,
      previewSessionKey: null,
      previewImported: false,
      previewStandalone: true,
      previewDisabled: false,
    };
  }

  applyTargetToTab(tab: EditorTab, target: PreviewTarget): void {
    const style = previewRefreshStyle(this.deps.previewRenderMode());
    const document = target.rootPath
      ? researchDocumentIdentity(this.deps.workspaceRootPath() ?? target.rootPath, target.mainPath, tab.path)
      : null;
    const identity = target.rootPath
      ? previewSessionIdentity(target.rootPath, style, document ?? undefined)
      : null;
    const session: PreviewSessionState = {
      previewRootPath: target.rootPath,
      previewMainPath: target.mainPath,
      previewTaskId: identity?.taskId ?? null,
      previewSessionKey: identity?.key ?? null,
      previewImported: target.imported,
      previewStandalone: target.standalone,
      previewDisabled: target.disabled,
    };
    this.applySessionToTab(tab, session);
  }

  capture(): PreviewSessionState {
    return { ...this.session };
  }

  captureCurrentMainSessionForImportedTarget(target: PreviewTarget): PreviewSessionState | null {
    if (target.standalone) return null;
    if (!target.imported || !target.mainPath || !this.rootPath || !this.sessionKey) return null;

    const mainKey = filePathKey(target.mainPath);
    const currentRootMatchesMain = filePathKey(this.rootPath) === mainKey;
    const currentMainMatchesMain = this.mainPath
      ? filePathKey(this.mainPath) === mainKey
      : false;
    if (!currentRootMatchesMain && !currentMainMatchesMain) return null;

    return {
      ...this.capture(),
      previewMainPath: target.mainPath,
      previewImported: target.imported,
      previewStandalone: target.standalone,
      previewDisabled: target.disabled,
    };
  }

  applySessionToTab(tab: EditorTab, session: PreviewSessionState): void {
    tab.previewRootPath = session.previewRootPath;
    tab.previewMainPath = session.previewMainPath;
    tab.previewTaskId = session.previewTaskId;
    tab.previewSessionKey = session.previewSessionKey;
    tab.previewImported = session.previewImported;
    tab.previewStandalone = session.previewStandalone;
    tab.previewDisabled = session.previewDisabled;
    this.session = { ...session };
  }

  async prepareTemplateAware(
    target: PreviewTarget,
    activePath: string,
    activeContents: string,
  ): Promise<PreviewTarget> {
    const workspaceRootPath = this.deps.workspaceRootPath();
    if (
      !workspaceRootPath
      || !target.imported
      || !target.standalone
      || !target.mainPath
      || !target.rootPath
      || filePathKey(target.rootPath) !== filePathKey(activePath)
    ) return target;

    try {
      const mainText = await this.deps.readWorkspaceText(target.mainPath);
      const application = findLocalTemplateApplication(mainText);
      if (!application) return target;
      const templatePath = await join(await dirname(target.mainPath), application.importPath);
      if (!await invoke<boolean>("workspace_path_exists", { path: templatePath })) return target;
      const templateRootPath = this.rootRelativeTypstPath(templatePath, workspaceRootPath);
      const chapterRootPath = this.rootRelativeTypstPath(activePath, workspaceRootPath);
      if (!templateRootPath || !chapterRootPath) return target;

      const identity = previewSessionIdentity(
        activePath,
        previewRefreshStyle(this.deps.previewRenderMode()),
        researchDocumentIdentity(workspaceRootPath, target.mainPath, activePath),
      );
      const previewPath = await join(
        workspaceRootPath,
        `.${fileNameFromPath(activePath)}.${identity.taskId}.typsastra-preview.typ`,
      );
      const previewSource = templatePreviewSource(application, templateRootPath, chapterRootPath, activeContents);
      const existingSource = await invoke<string>("read_workspace_file", { path: previewPath }).catch(() => null);
      if (existingSource !== previewSource) {
        await invoke("save_workspace_file", { path: previewPath, contents: previewSource });
      }
      return { ...target, rootPath: previewPath };
    } catch (error) {
      this.deps.logWarning(
        `Using direct standalone preview because the main template could not be reused: ${String(error)}`,
      );
      return target;
    }
  }

  private rootRelativeTypstPath(path: string, workspaceRootPath: string): string | null {
    const value = relativeFilePath(workspaceRootPath, path);
    if (value === null) return null;
    return `/${value.replace(/\\/g, "/")}`;
  }
}
