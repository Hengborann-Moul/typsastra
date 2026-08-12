import { listen } from "@tauri-apps/api/event";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { dirname, join } from "@tauri-apps/api/path";
import { EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, lineNumbers } from "@codemirror/view";
import { undo, redo, undoDepth } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { closeBrackets, completionStatus } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { editorMatchQuery, getEditorExtensions, themeCompartment, getThemeExtension, applyUIThemeVariables, wrapCompartment, lineNumbersCompartment, activeLineCompartment, closeBracketsCompartment, indentationGuidesCompartment, tabSizeCompartment, completionCompartment, languageCompartment, showZwsCompartment, showZeroWidthSpaces, visibleIndentationMarkers } from "./editor/extensions";
import { typstLanguage } from "./editor/typstLanguage";
import { createTypstAutocomplete } from "./editor/autocomplete";
import { EditorController } from "./editor/editorController";
import {
  mergeDiscoveredSurroundWithOptions,
  SURROUND_WITH_OPTIONS,
  type SurroundWithCompletionItem,
  type SurroundWithOption,
} from "./editor/surroundWith";
import { isForwardSyncContentPosition } from "./editor/forwardSyncEligibility";
import type { EditorFoldRange } from "./editor/folding";
import { setEditorDiagnosticsEffect } from "./editor/diagnostics";
import { WorkspaceExplorer } from "./components/explorer";
import { SidebarController } from "./sidebar/sidebarController";
import { TypographyController } from "./typography/typographyController";
import { ImageToolsController, type ProjectImageReference } from "./components/imageTools";
import { TinymistLspClient } from "./compiler/lsp";
import { DocumentSessionController } from "./session/documentSessionController";
import { type EditorTextEdit, type LspDiagnostic, type LspInverseSyncResult, type LspLogEntry, type LspSourcePosition, type LspStatus } from "./compiler/lsp";
import type { AppSettings, DeveloperLogCategory, PreviewRenderMode, ThemeName } from "./settings";
import { SettingsController } from "./settingsController";
import { fileNameFromPath, filePathFromUri, filePathKey, filePathToUri, relativeFilePath, remapFilePath } from "./platform/paths";
import { isBinaryImagePath, isMarkdownDocumentPath, isSupportedInAppPath, isTypstDocumentPath, fileExtension } from "./platform/fileTypes";
import { WysiwymAdapter } from "./wysiwym/adapter";
import type { PreviewFrame, PreviewClickPoint, PreviewInteractionStatus, PreviewPageStatus, PreviewSurface } from "./preview/previewFrame";
import type { MarkdownPreviewFrame, MarkdownResource } from "./preview/markdownPreviewFrame";
import { PreviewController } from "./preview/previewController";
import { PreviewSyncController } from "./preview/previewSyncController";
import { PreviewSourceNavigationController } from "./preview/previewSourceNavigationController";
import { PreviewUiController } from "./preview/previewUiController";
import { PreviewContentController } from "./preview/previewContentController";
import { SourceMapSessionController } from "./preview/sourceMapSessionController";
import { ImagePreviewController } from "./preview/imagePreviewController";
import {
  DraftPreviewController,
  type DraftThumbnailQueueMetric,
} from "./preview/draftPreviewController";
import { PdfPreviewPreparationController } from "./preview/pdfPreviewPreparationController";
import { PdfPreviewRenderController, type PdfUpdatePayload } from "./preview/pdfPreviewRenderController";
import { activeFileCanRenderPreview, allowsStandalonePreview, documentScriptsForPreviewContext, participatesInPreviewCompilation, previewLspMainPath, previewRefreshStyle, previewSessionIdentity, researchDocumentIdentity, type PreviewTarget, type PreviewRefreshStyle } from "./preview/previewPolicy";
import { LogConsoleController, type LogConsoleEntryInput } from "./diagnostics/logConsoleController";
import { DiagnosticsController } from "./diagnostics/diagnosticsController";
import { PreviewFailureController } from "./diagnostics/previewFailureController";
import { EditorFontManager } from "./editor/fontManager";
import { TabStripController } from "./editor/tabStripController";
import { EditorSessionController } from "./editor/editorSessionController";
import { EditorTabViewController } from "./editor/editorTabViewController";
import { AppDialogController } from "./ui/appDialog";
import { LayoutController } from "./layout/layoutController";
import type { WorkspaceMetadata } from "./workspace/workspaceStateStore";
import { RecentProjectsController } from "./workspace/recentProjectsController";
import {
  type WorkspaceChange
} from "./workspace/workspaceWatcher";
import { WorkspaceController } from "./workspace/workspaceController";
import {
  WorkspaceLifecycleController,
  type WorkspaceLifecycleDependencies,
} from "./workspace/workspaceLifecycleController";
import { ProjectImportController } from "./workspace/projectImportController";
import { ExternalWorkspaceController } from "./workspace/externalWorkspaceController";
import {
  largeFileOpeningNotice,
  largeMainPreviewOpeningNotice,
  type LargeFileOpeningNotice,
} from "./workspace/largeFileOpening";
import { PerformanceController } from "./performance/performanceController";
import { EditorToolbarController } from "./editor/toolbarController";
import { ContextMenuController } from "./components/contextMenuController";
import { ToolchainController, type ToolchainStatus } from "./toolchain/toolchainController";
import { DocumentOutlineController, type DocumentHeading } from "./outline/documentOutline";
import { WindowStateController } from "./window/windowStateController";
import { bindAppEvents } from "./ui/appEventBindings";
import { ReleaseSummaryController } from "./ui/releaseSummaryController";
import { ProjectExportController } from "./export/projectExportController";
import {
  parseTypographyBlock,
  parseDocumentScripts,
  documentScriptsEdit,
  typographyEdit,
  type DocumentTypography
} from "./editor/documentTypography";
import {
  SpellcheckController,
  type SpellcheckDebugEvent,
  type SpellingIssue,
} from "./editor/spellcheck";
import { DocumentLanguageService } from "./editor/languageScopes";
import type { ImportedTypsastraProject } from "./projectArchive";
import { AppUpdateController } from "./appUpdateController";
import { WebviewStorageController } from "./webviewStorageController";
import { SystemResumeMonitor } from "./platform/systemResume";
import { WorkspaceResumeController } from "./platform/workspaceResumeController";
import { setImageOptimizationWarningsEffect } from "./editor/imageWarnings";
import {
  captureEditorUndoHistory,
  createTabEditorState,
} from "./editor/tabHistory";
import type { EditorTab, PreviewSessionState } from "./editor/editorTab";
import { DocumentPersistenceController, type SaveIntent } from "./editor/documentPersistenceController";
import { EditorFileGuardController } from "./editor/editorFileGuardController";

import {
  ensureTypographyTemplateApplication,
  findLocalTemplateApplication,
  findTemplateFunctionName,
  newTypographyTemplate,
  templatePreviewSource,
  templateTypographyEdit
} from "./editor/templateTypography";

type EditorMode = "CODE" | "WYSIWYM";

const DEFAULT_INPUT_WIDTH_PCT = 50;
const DEFAULT_PREVIEW_WIDTH_PCT = 100 - DEFAULT_INPUT_WIDTH_PCT;
const DEFAULT_EXPLORER_WIDTH_PX = 250;
function isPreviewOnlyWindow(): boolean {
  return new URLSearchParams(window.location.search).get("mode") === "preview";
}

type UndockedPreviewAction = "export-pdf" | "open-external";

type ActivateEditorTabOptions = {
  preservePreviewSession?: PreviewSessionState;
  skipPreviewActivation?: boolean;
  focusEditor?: boolean;
  largeFileConfirmed?: boolean;
};

type LoadFileOptions = {
  temporary?: boolean;
  preservePreviewSession?: PreviewSessionState;
  skipPreviewActivation?: boolean;
  focusEditor?: boolean;
};

function normalizeEditorText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export class TypsastraWorkspaceController {
  /**
   * Temporary compatibility adapter while lifecycle-owned state is moved out
   * of the root controller. Consumers compile against the explicit port rather
   * than receiving the root as `object` and recovering it through `any`.
   */
  private createWorkspaceLifecycleDependencies(): WorkspaceLifecycleDependencies {
    const root = this;
    return new Proxy({} as WorkspaceLifecycleDependencies, {
      get(_target, property) {
        const value: unknown = Reflect.get(root, property, root);
        return typeof value === "function" ? value.bind(root) : value;
      },
      set(_target, property, value) {
        return Reflect.set(root, property, value, root);
      },
    });
  }

  private readonly startupStart = performance.now();
  private activeMode: EditorMode = "CODE";
  private readonly editorSessionController = new EditorSessionController();
  private get activeFilePath(): string | null { return this.editorSessionController.activeFilePath; }
  private set activeFilePath(path: string | null) { this.editorSessionController.activeFilePath = path; }
  private get openTabs(): EditorTab[] { return this.editorSessionController.tabs; }
  private set openTabs(tabs: EditorTab[]) { this.editorSessionController.replaceTabs(tabs); }
  private previewRootPath: string | null = null;
  private previewMainPath: string | null = null;
  private previewTaskId: string | null = null;
  private previewSessionKey: string | null = null;
  private previewImported = false;
  private previewStandalone = true;
  private previewDisabled = false;
  private pinnedLspMainPath: string | null = null;
  private pinnedMainFilePath: string | null = null;
  private mainDocumentScripts: DocumentTypography["fonts"] = [];
  private workspaceRootPath: string | null = null;
  private workspaceMetadata: WorkspaceMetadata | null = null;
  private workspaceLoading = false;
  private workspaceServicesDeferredForLargeFile = false;
  private readonly approvedLargePreviewRoots = new Set<string>();
  private readonly inspectedPreviewRoots = new Set<string>();
  private blockedLargePreviewRoot: string | null = null;
  private previewScrollTop = 0;
  private previewScrollSaveTimer: number | null = null;
  private recommendedWorkspaceToolchain: { tinymistVersion: string; typstVersion: string } | null = null;
  private selectedWorkspaceToolchain: { tinymistVersion: string; typstVersion: string } | null = null;
  private currentVersion = 1;
  private isLoadingFile = false;
  private readonly lspSyncDebounceMs = 50;
  private forwardSyncDebounceMs = 120;
  private latestDocumentVersion = 1;
  private diagnosticWaitStartedAt: number | null = null;
  private readonly detectedPlainTextPaths = new Set<string>();
  private readonly classifiedUnknownPaths = new Set<string>();
  private documentOutlineUpdateTimer: number | null = null;
  private documentOutlineUpdateGeneration = 0;
  private readonly openedDocumentUris = new Set<string>();
  private lastKhmerRenderPrepState: boolean | undefined = undefined;
  private lastPreviewRenderMode: PreviewRefreshStyle | undefined = undefined;
  private projectImportQueue: Promise<void> = Promise.resolve();
  private readonly blockedLargePdfPaths = new Set<string>();
  private get previewPageStatus(): PreviewPageStatus { return this.previewUiController.pageStatus; }
  private get pdfPreviewGeneration(): number { return this.pdfPreviewRenderController.generation; }
  private get pdfPreparationRevision(): number { return this.pdfPreviewRenderController.preparationRevision; }
  private get pdfPreviewRunning(): boolean { return this.pdfPreviewRenderController.running; }
  private get pdfPreviewSourceMapRootPath(): string | null { return this.pdfPreviewRenderController.sourceMapRootPath; }
  private get pdfPreviewSourceMapTaskId(): string | null { return this.pdfPreviewRenderController.sourceMapTaskId; }
  private get lastPdfPath(): string { return this.pdfPreviewRenderController.lastPdfPath; }
  private get lastPdfIdentity(): string { return this.pdfPreviewRenderController.lastPdfIdentity; }
  private get lastPdfSessionKey(): string { return this.pdfPreviewRenderController.lastPdfSessionKey; }
  private get lastPdfSurface(): PreviewSurface { return this.pdfPreviewRenderController.lastPdfSurface; }
  private lastFailedPreviewContents: string | null = null;
  private lastPreviewRecoveryRequestedContents: string | null = null;
  private tinymistPreviewRecoveryAttempts = 0;
  private tinymistPreviewRecovery: Promise<boolean> | null = null;
  private readonly externalConflictPaths = new Set<string>();
  private externalPreviewRefreshPending = false;
  private get managedPreviewPdfPathKeys(): ReadonlySet<string> { return this.pdfPreviewRenderController.managedPdfPathKeys; }
  private readonly managedImageToolPathKeys = new Set<string>();
  private readonly settingsController: SettingsController = new SettingsController(
    settings => this.applySettingsToRuntime(settings),
    providers => this.handleLanguageProvidersChanged(providers),
    () => this.typographyController.privateFontDirectoriesChanged(),
    () => this.typographyController.privateFontDirectoriesChanged()
  );
  private readonly toolchainController = new ToolchainController({
    getSelectedVersion: () => this.settingsController.value.toolchain.tinymistVersion,
    setSelectedVersion: version => this.settingsController.update(settings => {
      settings.toolchain.tinymistVersion = version;
    }),
    onToolchainChanged: status => {
      if (this.workspaceRootPath && status.tinymistVersion && status.typstVersion) {
        this.selectedWorkspaceToolchain = {
          tinymistVersion: status.tinymistVersion,
          typstVersion: status.typstVersion
        };
        this.saveWorkspaceState();
      }
      return this.handleToolchainChanged(status);
    }
  });

  private editorInstance!: EditorView;
  private editorExtensions: Extension = [];
  private readonly performanceController = new PerformanceController({
    isLogEnabled: category => this.isDeveloperLogEnabled(category),
    appendLog: entry => this.appendDeveloperLog(entry),
    previewMemorySnapshot: () => this.previewFrame.memorySnapshot(),
    lastPdfPath: () => this.lastPdfPath,
    openTabCount: () => this.openTabs.length,
    openDocumentUtf16: () => this.openTabs.reduce((total, tab) => total + tab.content.length, 0),
    editorUndoDepth: () => this.editorInstance?.state ? undoDepth(this.editorInstance.state) : 0,
  });
  private readonly editorController = new EditorController({
    performanceEnabled: () => this.isDeveloperLogEnabled("performance"),
    recordPerformance: metric => this.performanceController.record(metric),
    logLayoutRefresh: reason => this.appendDeveloperLog({
      kind: "log",
      source: "editor layout",
      message: `Requested CodeMirror layout refresh after ${reason}.`,
    }),
    suppressPreviewSync: durationMs => this.previewSyncController.suppressForwardFor(durationMs),
    revealPreviewAtCursor: cursor => void this.previewSyncController.renderAtCursor(cursor),
    activePath: () => this.activeFilePath,
    pathKey: filePathKey,
    contentMutationDelay: () => this.effectivePreviewRenderMode === "on-type"
      ? Math.min(300, this.settingsController.value.preview.syncDebounceMs)
      : 300,
    onContentMutationStart: path => {
      if (
        this.effectivePreviewRenderMode === "on-type"
        && activeFileCanRenderPreview(
          path,
          this.pinnedMainFilePath,
          this.previewImported,
          this.previewDisabled,
        )
      ) this.invalidatePreviewWork("editor input");
    },
    onContentMutation: (_path, text, previewDebounceElapsedMs) => {
      this.configureDocumentLanguageTools(text);
      this.editorFontManager.scheduleDocumentUpdate(text);
      this.handleContentMutation(text, previewDebounceElapsedMs);
    },
    onFoldStateChanged: ranges => {
      const tab = this.getActiveTab();
      if (!tab) return;
      tab.foldStateExplicit = true;
      tab.foldRanges = ranges;
      void this.saveWorkspaceState();
    },
  });
  private isComposing = false;
  private readonly editorFontManager = new EditorFontManager(() => this.editorInstance);
  private readonly markdownEditorLanguage = markdown({ base: markdownLanguage });
  private readonly spellcheckController = new SpellcheckController(
    () => this.editorInstance,
    issues => this.updateSpellcheckLog(issues),
    metric => this.performanceController.record(metric),
    event => this.appendSpellcheckDebug(event),
  );
  private explorer!: WorkspaceExplorer;
  private readonly documentSessionController = new DocumentSessionController({
    createClient: () => this.createTinymistClient(),
    resetSessionState: () => this.resetTinymistSessionState(),
    onConnected: () => this.handleTinymistConnected(),
    onRestarted: () => {
      // Temporary discovery documents can interfere with restoration of the
      // real workspace document immediately after a restart.
      this.surroundWithOptions = SURROUND_WITH_OPTIONS;
    },
    setStoppedStatus: message => this.setLspStatus({ kind: "stopped", message }),
    setStartingStatus: message => this.setLspStatus({ kind: "starting", message }),
    logLifecycle: message => this.appendDeveloperLog({
      kind: "info",
      source: "lsp lifecycle",
      message,
    }),
    logConnectionFailure: error => console.warn("Tinymist LSP instance offline.", error),
  });
  private get lspClient(): TinymistLspClient {
    return this.documentSessionController.client;
  }
  private get lspReady(): boolean {
    return this.documentSessionController.ready;
  }
  private set lspReady(ready: boolean) {
    this.documentSessionController.setReady(ready);
  }
  private readonly pdfPreviewPreparationController = new PdfPreviewPreparationController({
    getActiveFilePath: () => this.activeFilePath,
    getPreviewRootPath: () => this.previewRootPath,
    getPreviewMainPath: () => this.previewMainPath,
    getPinnedMainFilePath: () => this.pinnedMainFilePath,
    isPreviewStandalone: () => this.previewStandalone,
    getWorkspaceRootPath: () => this.workspaceRootPath,
    getCacheRootPath: () => this.getCacheRootPath(),
    mapToOriginalPath: path => this.mapToOriginalPath(path),
    getOpenTabs: () => this.openTabs,
    isKhmerRenderPreparationEnabled: () => this.settingsController.value.preview.khmerRenderPreparation,
    getPreviewRenderMode: () => this.effectivePreviewRenderMode,
    getPreparationRevision: () => this.pdfPreparationRevision,
    getLspClient: () => this.lspClient,
    listOpenedDocumentUris: () => [...this.openedDocumentUris],
    addOpenedDocumentUri: uri => this.openedDocumentUris.add(uri),
    removeOpenedDocumentUri: uri => this.openedDocumentUris.delete(uri),
    nextDocumentVersion: () => ++this.currentVersion,
    isRenderCachePath: path => this.isRenderCachePath(path),
    log: (kind, source, message) => this.appendDeveloperLog({ kind, source, message }),
  });
  private get pdfPreviewGeneratedFiles() {
    return this.pdfPreviewPreparationController.generatedFiles;
  }
  private surroundWithOptions: readonly SurroundWithOption[] = SURROUND_WITH_OPTIONS;
  private surroundWithDiscoveryGeneration = 0;

  private codePane = document.getElementById("code-editor-pane")!;
  private editorTabBar = document.getElementById("editor-tab-bar")!;
  private readonly editorTabViewController = new EditorTabViewController(this.editorTabBar, {
    tabs: () => this.openTabs,
    activeFilePath: () => this.activeFilePath,
    pinnedMainFilePath: () => this.pinnedMainFilePath,
    sortPinnedMainFirst: () => this.editorSessionController.sortPinnedMainFirst(this.pinnedMainFilePath),
    activateTab: path => this.activateEditorTab(path),
    closeTab: path => this.closeEditorTab(path),
    promoteTab: tab => this.promoteToPermanent(tab),
    reportActivationFailure: (path, error) => {
      console.error("Failed to load restored tab:", path, error);
      void message(`Could not open ${fileNameFromPath(path)}: ${String(error)}`, {
        title: "Unable to Open File",
        kind: "error"
      });
    },
  });
  private readonly editorFileGuardController = new EditorFileGuardController({
    previewFrame: () => this.previewFrame,
    onPdfBlocked: path => {
      this.blockedLargePdfPaths.add(filePathKey(path));
      this.pdfPreviewRenderController.cancelPendingPdfLoad();
      this.invalidatePreviewWork(`waiting for confirmation to open ${path}`);
    },
    onPdfUnblocked: path => this.blockedLargePdfPaths.delete(filePathKey(path)),
    onPdfReblocked: path => { this.blockedLargePdfPaths.add(filePathKey(path)); },
    onTypstPreviewBlocked: rootPath => {
      this.workspaceServicesDeferredForLargeFile = true;
      this.blockedLargePreviewRoot = rootPath;
    },
    approveLargePreview: (tab, notice) => this.approveLargePreviewForTab(tab, notice),
    activateConfirmedTab: path => this.activateEditorTab(path, false, { largeFileConfirmed: true }),
    onGuardedTabSelected: path => {
      this.activeFilePath = path;
      this.activateSpellcheckDocument(null);
      this.documentOutlineController.clear();
      this.clearDiagnostics();
      this.clearPendingLspSync();
      this.previewSyncController.clearForward();
      this.editorToolbarController.setDisabled(true);
      this.updatePreviewActionsToolbar(path);
      this.updateManualForwardSyncAction();
      this.updateWorkspaceViewportVisibility();
      this.renderEditorTabs();
      void this.saveWorkspaceState();
    },
  });
  private readonly tabStripController = new TabStripController(
    this.editorTabBar,
    document.getElementById("editor-tabs-previous") as HTMLButtonElement,
    document.getElementById("editor-tabs-next") as HTMLButtonElement
  );
  private editorVisualToolbar = document.getElementById("editor-visual-toolbar")!;
  private codeRenderPane = document.getElementById("code-render-pane")!;
  // WYSIWYM is intentionally disabled for this release. Keep a detached
  // container so the future adapter code can remain compiled without putting
  // the WYSIWYM pane into the active editor layout.
  private wysiwymPane = document.getElementById("wysiwym-editor-pane") as HTMLElement | null;
  private wysiwymContainer = this.wysiwymPane?.querySelector<HTMLElement>(".wysiwym-container") ?? document.createElement("div");
  private readonly wysiwymAdapter = new WysiwymAdapter(this.wysiwymContainer);
  private previewPane = document.getElementById("preview-render-pane")!;
  private readonly imageToolsController = new ImageToolsController(
    document.getElementById("image-tools-sidebar")!,
    document.getElementById("image-tools-inspector")!,
    document.getElementById("image-tools-comparison")!,
    reference => void this.navigateToImageReference(reference),
    (source, imagePath) => this.renderImageToolPreview(source, imagePath),
    (paths, phase) => this.handleImageToolFilesWritten(paths, phase),
  );
  private readonly sidebarController = new SidebarController({
    hasWorkspace: () => !!this.workspaceRootPath,
    isWorkspaceLoading: () => this.workspaceLoading,
    isActiveSurfaceNonText: () => {
      const path = this.activeFilePath;
      return !!path && (
        !this.isInternallySupportedPath(path)
        || isBinaryImagePath(path)
        || fileExtension(path) === "pdf"
      );
    },
    invalidatePreview: reason => this.invalidatePreviewWork(reason),
    showImageTools: () => this.imageToolsController.show(),
    hideImageTools: () => this.imageToolsController.hide(),
    showRestoringPreview: () => this.previewFrame.setMessage(
      `<div class="preview-disabled-placeholder"><div class="guardrail-placeholder-content">` +
      `<div class="preview-disabled-title preview-accent-title">Restoring Preview</div>` +
      `<div class="preview-disabled-msg">Preparing the active document preview.</div>` +
      `</div></div>`,
    ),
    restoreDocumentPreview: () => void this.refreshActivePreviewRoot(false),
    setMainPreviewVisibleWhileUndocked: visible =>
      this.layoutController.setMainPreviewVisibleWhileUndocked(visible),
    reconcileDockedPaneWidths: () => this.layoutController.reconcileDockedPaneWidths(),
    persist: () => void this.saveWorkspaceState(),
  }, this.codeRenderPane, this.previewPane);
  private readonly previewController = new PreviewController(this.previewPane, {
    onPreviewClick: point => void this.handlePdfPreviewClick(point),
    onInteractionStatus: status => this.reportPreviewInteractionStatus(status),
    onZoomChanged: zoomPercent => this.updatePreviewZoomLabel(zoomPercent),
    onPerformance: metric => {
      this.performanceController.recordFirst(metric) ?? this.performanceController.record(metric);
    },
    onPageChanged: status => this.updatePreviewPageStatus(status),
    loadDraftImage: id => this.draftPreviewController.loadImage(id),
    onScrollPositionChanged: scrollTop => {
      this.previewScrollTop = Math.max(0, scrollTop);
      if (!this.workspaceRootPath || !this.workspaceMetadata) return;
      if (this.previewScrollSaveTimer !== null) window.clearTimeout(this.previewScrollSaveTimer);
      this.previewScrollSaveTimer = window.setTimeout(() => {
        this.previewScrollSaveTimer = null;
        void this.saveWorkspaceState();
      }, 750);
    },
    onLoadStage: (stage, detail) => {
      // Preview-only windows skip the workspace bootstrap. Their PDF lifecycle
      // is already represented by the main window's diagnostics.
      if (isPreviewOnlyWindow()) return;
      return this.performanceController.logMemoryDiagnostics(`PDF ${stage}`, detail);
    },
    resolveMarkdownImage: (documentPath, source) => this.resolveMarkdownImage(documentPath, source),
    openMarkdownLink: (documentPath, href) => this.openMarkdownLink(documentPath, href),
  });
  private get previewFrame(): PreviewFrame { return this.previewController.pdf; }
  private get markdownPreviewFrame(): MarkdownPreviewFrame { return this.previewController.markdown; }
  private readonly sourceMapSessionController: SourceMapSessionController = new SourceMapSessionController({
    log: (source, kind, message) => this.appendDeveloperLog({ kind, source, message }),
    onPositionPayload: text => this.previewSyncController.handlePositionPayload(text),
    activeFilePath: () => this.activeFilePath,
    pathKey: filePathKey,
  });
  private readonly previewSyncController: PreviewSyncController = new PreviewSyncController({
    getEditor: () => this.editorInstance,
    getClient: () => this.lspClient,
    getActiveFilePath: () => this.activeFilePath,
    getPreviewRootPath: () => this.previewRootPath,
    getPreviewTaskId: () => this.previewTaskId,
    isReady: () => this.lspReady,
    // TODO: Re-enable in prerelease v0.9.0 after improving performance and timeout reliability
    // isEnabled: () => this.settingsController.value.preview.cursorSync,
    isEnabled: () => false,
    handleForwardPosition: (path, cursor) => this.previewSyncController.handlePdfForward(path, cursor),
    mapForwardPosition: async () => null,
    sourceMap: this.sourceMapSessionController,
    getPdfContext: () => ({
      rootPath: this.pdfPreviewSourceMapRootPath ?? this.previewRootPath,
      taskId: this.pdfPreviewSourceMapTaskId ?? this.previewTaskId,
      previewUrl: this.previewFrame.currentUrl,
      previewGeneration: this.pdfPreviewGeneration,
      refreshStyle: previewRefreshStyle(this.effectivePreviewRenderMode),
      timeoutMs: this.settingsController.value.preview.forwardSyncTimeoutMs,
      externalRefreshPending: this.externalPreviewRefreshPending,
      previewRunning: this.pdfPreviewRunning,
      previewDisabled: this.previewDisabled,
      interactionBlocked: this.workspaceResumeController.interactionBlocked,
    }),
    isForwardPositionEligible: (path, cursor) => !(
      this.activeFilePath
      && filePathKey(path) === filePathKey(this.activeFilePath)
      && !isForwardSyncContentPosition(this.editorInstance.state, cursor)
    ),
    mapPdfForwardTarget: (path, cursor) => this.forwardSyncTarget(path, cursor),
    setStatus: status => this.setLspStatus(status),
    updateManualAction: (busy, available) => this.renderManualForwardSyncAction(busy, available),
    log: (source, kind, message) => this.appendDeveloperLog({ kind, source, message }),
    revealDocumentPosition: position => this.previewFrame.revealDocumentPosition(position, { ripple: true }),
    emitForwardPosition: position => {
      import("@tauri-apps/api/event").then(({ emit }) => {
        emit("pdf-forward-sync", position);
      }).catch(err => console.error("Error emitting pdf-forward-sync", err));
    },
  });
  private readonly logConsoleController = new LogConsoleController(entry => this.navigateToLogEntry(entry));
  private readonly diagnosticsController = new DiagnosticsController(this.logConsoleController, {
    editor: () => this.editorInstance,
    client: () => this.lspClient,
    activeFilePath: () => this.activeFilePath,
    pathKey: filePathKey,
    mapToOriginalPath: path => this.mapToOriginalPath(path),
    isRenderCachePath: path => this.isRenderCachePath(path),
    previewImported: () => this.previewImported,
    previewStandalone: () => this.previewStandalone,
    latestDocumentVersion: () => this.latestDocumentVersion,
    hasPendingSync: path => this.documentSessionController.hasPendingSyncFor(path, filePathKey),
    spellcheck: () => this.spellcheckController,
    recordFirstDiagnostics: diagnosticCount => {
      if (this.diagnosticWaitStartedAt === null) return;
      this.performanceController.recordFirst({
        name: "diagnostics.first",
        milliseconds: performance.now() - this.diagnosticWaitStartedAt,
        detail: { diagnosticCount },
      });
      this.diagnosticWaitStartedAt = null;
    },
    logDeveloper: (kind, source, message) => this.appendDeveloperLog({ kind, source, message }),
    acceptedDiagnosticsChanged: diagnostics => this.recoverPreviewAfterAcceptedDiagnostics(diagnostics),
    openDiagnosticFile: async path => {
      const previewSession = this.previewRootPath ? this.capturePreviewSession() : undefined;
      await this.loadFile(path, { preservePreviewSession: previewSession });
    },
    activeTabContentLoaded: () => this.getActiveTab()?.contentLoaded === true,
    editorPositionFromSourceLocation: (line, column) => this.editorPositionFromSourceLocation(line, column),
  });
  private readonly previewFailureController = new PreviewFailureController(this.logConsoleController, {
    mapToOriginalPath: path => this.mapToOriginalPath(path),
    sourceForPath: async path => {
      const generated = this.pdfPreviewGeneratedFiles.get(filePathKey(path));
      const openTab = this.openTabs.find(tab => filePathKey(tab.path) === filePathKey(path));
      return generated?.preparedText
        ?? (openTab?.contentLoaded ? openTab.content : null)
        ?? await invoke<string>("read_workspace_file", { path }).catch(() => "");
    },
    isRenderCachePath: path => this.isRenderCachePath(path),
  });
  private readonly layoutController = new LayoutController(
    () => this.saveWorkspaceState(),
    () => this.logConsoleController.setVisible(false),
    message => this.appendDeveloperLog({ kind: "info", source: "preview layout", message }),
    () => this.workspaceResumeController.beginHorizontalResize(),
    () => this.workspaceResumeController.endHorizontalResize()
  );
  private readonly workspaceController = new WorkspaceController({
    dockPreview: () => this.layoutController.dockPreview(),
    applySidebarVisibility: () => this.sidebarController.applyVisibility(),
    pathKey: filePathKey,
    handleWorkspaceChange: change => this.handleWorkspaceChange(change),
    reportWatchError: error => this.reportWorkspaceWatchError(error),
    persistActiveTabState: () => this.persistActiveTabState(),
    persistenceSnapshot: () => ({
      rootPath: this.workspaceRootPath,
      metadata: this.workspaceMetadata,
      activeFilePath: this.activeFilePath,
      pinnedMainFilePath: this.pinnedMainFilePath,
      recommendedToolchain: this.recommendedWorkspaceToolchain,
      selectedToolchain: this.selectedWorkspaceToolchain,
      openTabs: this.openTabs,
      expandedDirectories: this.explorer.expandedDirectoryPaths(),
      inputContainerWidthPct: this.layoutController.getDockedInputWidthPct(),
      explorerSidebarWidthPx: parseInt(
        document.getElementById("explorer-sidebar")?.style.width ?? "",
        10,
      ) || DEFAULT_EXPLORER_WIDTH_PX,
      sidebarVisible: this.sidebarController.visible,
      activeSidebarTool: this.sidebarController.activeTool,
      previewContentMode: this.draftPreviewController.mode,
      previewRenderMode: this.effectivePreviewRenderMode,
      previewScrollTop: this.previewScrollTop,
    }),
    setWorkspaceMetadata: metadata => {
      this.workspaceMetadata = metadata;
    },
    reportPersistenceError: error => this.appendDeveloperLog({
      kind: "error",
      source: "workspace",
      message: `Failed to save workspace state: ${String(error)}`,
    }),
  });
  private readonly workspaceLifecycleController = new WorkspaceLifecycleController(
    this.createWorkspaceLifecycleDependencies(),
  );
  private readonly imagePreviewController = new ImagePreviewController({
    setMessage: html => this.previewFrame.setMessage(html),
    setError: (title, detail) => this.previewFrame.setError(title, detail),
    updateToolbar: path => this.updatePreviewActionsToolbar(path),
    updateZoomLabel: scale => this.updatePreviewZoomLabel(scale),
  });
  private readonly projectImportController = new ProjectImportController({
    setStatus: status => this.setLspStatus(status),
    selectToolchainVersion: version => this.settingsController.update(settings => {
      settings.toolchain.tinymistVersion = version;
    }),
    handleToolchainChanged: status => this.handleToolchainChanged(status),
    completeImport: (imported, projectName) => this.completeProjectImport(imported, projectName),
  });
  private readonly externalWorkspaceController = new ExternalWorkspaceController({
    workspaceRoot: () => this.workspaceRootPath,
    pathKey: filePathKey,
    openTabPaths: () => this.openTabs.map(tab => tab.path),
    conflictPaths: () => this.externalConflictPaths,
    managedPathKeys: () => new Set([
      ...this.managedPreviewPdfPathKeys,
      ...this.managedImageToolPathKeys,
    ]),
    reloadOpenFiles: refreshPreview => this.reloadOpenFilesFromDisk(refreshPreview),
    lspClient: () => this.lspClient,
    lspReady: () => this.lspReady,
    loadExplorer: rootPath => this.explorer.loadWorkspace(rootPath),
    refreshImageTools: () => { void this.imageToolsController.refresh(); },
    imageToolsActive: () => this.sidebarController.activeTool === "images",
    retireSourceMap: reason => this.retirePdfSourceMapSession(reason),
    refreshPreview: force => this.refreshActivePreviewRoot(force),
    waitForPreviewRefresh: () => this.waitForExternalPreviewRefresh(),
    setRefreshPending: pending => { this.externalPreviewRefreshPending = pending; },
    updateForwardSyncAction: () => this.updateManualForwardSyncAction(),
    log: (kind, message) => this.appendDeveloperLog({ kind, source: "workspace", message }),
  });
  private readonly typographyController: TypographyController = new TypographyController({
    getWorkspaceRootPath: () => this.workspaceRootPath,
    readWorkspaceText: path => this.workspaceText(path),
    logWarning: message => this.appendDeveloperLog({
      kind: "warning",
      source: "typography",
      message,
    }),
    getActiveFilePath: () => this.activeFilePath,
    getActiveDocumentText: () => this.editorInstance.state.doc.toString(),
    dispatchDocumentEdit: (edit, userEvent) => this.editorInstance.dispatch({
      changes: edit,
      userEvent,
    }),
    synchronizeDocumentTypography: config =>
      this.editorToolbarController.synchronizeDocumentTypography(config),
    isPinnedMainFile: path => this.isPinnedMainFile(path),
    getPinnedMainFilePath: () => this.pinnedMainFilePath,
    isPreviewImported: () => this.previewImported,
    getPreviewDebounceMs: () => this.settingsController.value.preview.syncDebounceMs,
    getPreviewRootPath: () => this.previewRootPath,
    getPreviewMainPath: () => this.previewMainPath,
    isPreviewStandalone: () => this.previewStandalone,
    isLargePreviewBlocked: () => Boolean(this.blockedLargePreviewRoot),
    hasLspClient: () => Boolean(this.lspClient),
    restartTinymistSession: status => this.restartTinymistSession(status),
    restoreActiveDocumentAfterRestart: () => this.restoreActiveDocumentAfterTinymistRestart(),
    refreshActivePreviewRoot: force => this.refreshActivePreviewRoot(force),
    updatePinnedMain: (path, force) => this.updatePinnedMain(path, force),
    recheckActiveDocumentAfterPin: text => this.recheckActiveDocumentAfterPin(text),
    resetSourceMap: () => this.sourceMapSessionController.reset({ retry: false }),
    setPreviewLoading: text => this.previewFrame.setLoading(text),
    appendLog: (kind, source, text) => {
      if (kind === "error") {
        this.appendLspLog({ kind, source, message: text });
      } else {
        this.appendDeveloperLog({ kind, source, message: text });
      }
    },
  });
  private readonly documentLanguageService = new DocumentLanguageService();
  private readonly recentProjectsController = new RecentProjectsController(
    path => this.openWorkspace(path),
    async path => {
      await message(
        `Typsastra could not find this project folder:\n\n${path}\n\nIt will be removed from your recent projects.`,
        {
          title: "Recent Project Not Found",
          kind: "warning",
          buttons: { ok: "Remove from Recent Projects" }
        }
      );
    }
  );
  private readonly editorToolbarController = new EditorToolbarController({
    getMode: () => this.activeMode,
    getEditor: () => this.editorInstance,
    wysiwymContainer: this.wysiwymContainer,
    serializeWysiwym: () => this.mapWysiwymToMarkup(),
    renderWysiwym: markup => this.mapMarkupToWysiwym(markup),
    save: () => this.saveActiveFile(),
    syncPreview: cursor => this.previewSyncController.renderAtCursor(cursor),
    applyTypography: (config, target) => this.applyTypography(config, target),
    getWorkspaceRoot: () => this.workspaceRootPath,
    onWorkspacePrivateFontDirectoriesChanged: () => this.typographyController.privateFontDirectoriesChanged()
    // TODO: Re-enable when the WYSIWYM layout is ready for use.
    // toggleMode: () => this.switchViewLayoutMode()
  });
  private readonly contextMenuController = new ContextMenuController({
    getWorkspaceRoot: () => this.workspaceRootPath,
    getActiveFile: () => this.activeFilePath,
    getEditor: () => this.editorInstance,
    getExplorer: () => this.explorer,
    getExplorerForElement: element => element.closest(".image-tool-list")
      ? this.imageToolsController.getExplorer()
      : this.explorer,
    refreshSecondaryExplorer: () => this.sidebarController.activeTool === "images"
      ? this.imageToolsController.refresh()
      : undefined,
    getPreviewFrame: () => this.previewFrame.element,
    loadFile: path => this.loadFile(path),
    save: () => this.saveActiveFile(),
    renameWorkspacePath: (oldPath, newPath, updateImageReferences) =>
      this.renameWorkspacePath(oldPath, newPath, updateImageReferences),
    closeTab: path => this.closeEditorTab(path, true),
    closeTabInteractive: path => this.closeEditorTab(path, false),
    closeOtherTabs: path => this.closeOtherTabs(path),
    restartWorkspace: () => this.restartWorkspace(),
    getSpellingIssue: (x, y, target) => {
      if (target) {
        const spellingSpan = target.closest(".cm-spelling-unknown, .cm-spelling-ignored");
        if (spellingSpan) {
          try {
            let pos = spellingSpan.firstChild ? this.editorInstance.posAtDOM(spellingSpan.firstChild) : null;
            if (pos === null) {
              pos = this.editorInstance.posAtDOM(spellingSpan);
            }
            if (pos !== null) {
              const issue = this.spellcheckController.issueAt(pos);
              if (issue) return issue;
            }
          } catch (e) {
            console.error("posAtDOM failed in getSpellingIssue:", e);
          }
        }
      }
      
      try {
        let position = this.editorInstance.posAtCoords({ x, y });
        if (position === null) {
          position = this.editorInstance.state.selection.main.head;
        }
        const issue = this.spellcheckController.issueAt(position);
        if (issue) return issue;
      } catch (e) {
        console.error("posAtCoords or line lookup failed in getSpellingIssue:", e);
      }
      return null;
    },
    getSpellingIssuesInRange: (from, to) => this.spellcheckController.issuesInRange(from, to),
    getSpellingSuggestions: issue => this.spellcheckController.suggestions(issue),
    replaceSpelling: (issue, replacement) => this.spellcheckController.replace(issue, replacement),
    addSpellingToDictionary: words => this.settingsController.update(settings => {
      for (const word of words) {
        if (!settings.editor.userDictionary.includes(word)) {
          settings.editor.userDictionary.push(word);
        }
      }
    }),
    addSpellingTerminology: (issue, scope) => {
      const entry = { term: issue.sourceText, exactCase: true };
      if (scope === "project") {
        if (!this.workspaceMetadata) return;
        const existing = this.workspaceMetadata.project.terminology;
        if (!existing.some(candidate => candidate.term === entry.term && candidate.exactCase === entry.exactCase)) {
          this.workspaceMetadata.project.terminology = [...existing, entry];
          this.settingsController.setProjectTerminology(this.workspaceMetadata.project.terminology);
          this.spellcheckController.setTerminology(
            this.settingsController.value.editor.globalTerminology,
            this.workspaceMetadata.project.terminology,
            this.settingsController.value.editor.languageTerminology,
            this.settingsController.value.editor.scopedIgnoredWords,
          );
          void this.saveWorkspaceState();
        }
        return;
      }
      this.settingsController.update(settings => {
        if (scope === "languageFamily" && issue.languageFamily) {
          if (!settings.editor.languageTerminology.some(candidate =>
            candidate.term === entry.term && candidate.languageFamily === issue.languageFamily)) {
            settings.editor.languageTerminology.push({ ...entry, languageFamily: issue.languageFamily });
          }
        } else if (!settings.editor.globalTerminology.some(candidate => candidate.term === entry.term)) {
          settings.editor.globalTerminology.push(entry);
        }
      });
    },
    setSpellingIgnored: (issue, ignored) => this.settingsController.update(settings => {
      if (ignored) {
        const entry = issue.languageFamily
          ? { term: issue.sourceText, scope: "languageFamily" as const, languageFamily: issue.languageFamily }
          : { term: issue.sourceText, scope: "global" as const };
        if (!settings.editor.scopedIgnoredWords.some(candidate => candidate.term === entry.term
          && candidate.scope === entry.scope && candidate.languageFamily === entry.languageFamily)) {
          settings.editor.scopedIgnoredWords.push(entry);
        }
      } else {
        settings.editor.ignoredWords = settings.editor.ignoredWords.filter(word => word !== issue.word);
        settings.editor.scopedIgnoredWords = settings.editor.scopedIgnoredWords.filter(entry =>
          entry.term !== issue.sourceText || (entry.languageFamily && entry.languageFamily !== issue.languageFamily));
      }
    }),
    isPinnedMainFile: path => this.isPinnedMainFile(path),
    setPinnedMainFile: path => this.setPinnedMainFile(path),
    getPinnedMainFile: () => this.pinnedMainFilePath,
    canRevealCursorInPreview: () => this.previewSyncController.canRevealManually()
      && isForwardSyncContentPosition(
        this.editorInstance.state,
        this.editorInstance.state.selection.main.head
      ),
    revealCursorInPreview: () => this.revealCursorInPreviewManually(),
    getSurroundWithOptions: () => this.surroundWithOptions,
  });
  private readonly documentOutlineController = new DocumentOutlineController(
    document.getElementById("document-outline-tree")!,
    document.getElementById("document-outline-section")!,
    heading => void this.navigateToOutlineHeading(heading)
  );
  private readonly appDialogController = new AppDialogController();
  private readonly releaseSummaryController = new ReleaseSummaryController();
  private readonly draftPreviewController = new DraftPreviewController(
    this.appDialogController,
    {
      activeFilePath: () => this.activeFilePath,
      workspaceRootPath: () => this.workspaceRootPath,
      editor: () => this.editorInstance ?? null,
      previewFrame: () => this.previewFrame,
      previewPageStatus: () => this.previewPageStatus,
      previewGeneration: () => this.pdfPreviewGeneration,
      renderMode: () => this.effectivePreviewRenderMode,
      saveWorkspaceState: () => this.saveWorkspaceState(),
      invalidatePreviewWork: reason => this.invalidatePreviewWork(reason),
      refreshActivePreviewRoot: force => this.refreshActivePreviewRoot(force),
      setPreviewRenderMode: mode => this.setPreviewRenderMode(mode),
      setImageOptimizationIssues: entries => this.logConsoleController.setImageOptimizationIssues(entries),
      setEditorWarnings: warnings => {
        if (!this.editorInstance) return;
        this.editorInstance.dispatch({ effects: setImageOptimizationWarningsEffect.of(warnings) });
      },
      showImages: async imagePath => {
        this.sidebarController.setTool("images");
        if (imagePath) await this.imageToolsController.selectImage(imagePath);
      },
      log: (kind, source, message) => this.appendDeveloperLog({ kind, source, message }),
    },
  );
  private readonly appUpdateController = new AppUpdateController(
    () => this.openTabs.some(tab => tab.isDirty),
    this.appDialogController
  );
  private readonly projectExportController = new ProjectExportController({
    activeFilePath: () => this.activeFilePath,
    activeContents: () => this.editorInstance.state.doc.toString(),
    previewStandalone: () => this.previewStandalone,
    previewRootPath: () => this.previewRootPath,
    previewMainPath: () => this.previewMainPath,
    workspaceRootPath: () => this.workspaceRootPath,
    cacheRootPath: () => this.getCacheRootPath(),
    mapToOriginalPath: path => this.mapToOriginalPath(path),
    openTabs: () => this.openTabs,
    khmerRenderPreparationEnabled: () => this.settingsController.value.preview.khmerRenderPreparation,
    setLspStatus: status => this.setLspStatus(status),
  });
  private readonly documentPersistenceController = new DocumentPersistenceController({
    activeFilePath: () => this.activeFilePath,
    activeMode: () => this.activeMode,
    workspaceRootPath: () => this.workspaceRootPath,
    openTabs: () => this.openTabs,
    isInternallySupportedPath: path => this.isInternallySupportedPath(path),
    flushEditorContentMutation: () => this.flushEditorContentMutation(),
    formatOnSave: () => this.settingsController.value.editor.formatOnSave,
    autoSaveSettings: () => ({
      enabled: this.settingsController.value.editor.autoSave,
      intervalSeconds: this.settingsController.value.editor.autoSaveIntervalSeconds,
    }),
    formatActiveDocument: options => this.formatActiveDocument(options),
    removeTrailingSpaces: () => this.removeTrailingSpaces(),
    editorText: () => this.editorInstance.state.doc.toString(),
    wysiwymMarkup: () => this.mapWysiwymToMarkup(),
    isPinnedMainFile: path => this.isPinnedMainFile(path),
    refreshWorkspaceExplorer: async workspaceRootPath => {
      await this.explorer.loadWorkspace(workspaceRootPath);
    },
    loadFile: path => this.loadFile(path),
    setPinnedMainFile: path => this.setPinnedMainFile(path),
    lspReady: () => this.lspReady && Boolean(this.lspClient),
    flushPendingLspSync: () => this.flushPendingLspSync(),
    notifyLspSave: async (path, content) => {
      const lspRes = await this.getLspUriAndContent(path, content);
      if (!lspRes) return;
      await this.lspClient.notifyTextSave(lspRes.uri, lspRes.content);
    },
    logMemoryDiagnostics: reason => this.performanceController.logMemoryDiagnostics(reason),
    clearExternalConflict: path => this.externalConflictPaths.delete(filePathKey(path)),
    renderEditorTabs: () => this.renderEditorTabs(),
    shouldRenderPreviewAfterManualSave: path => (
      participatesInPreviewCompilation(path, this.pinnedMainFilePath, this.previewImported)
      && !this.previewDisabled
    ),
    renderPdfPreview: content => this.renderPdfPreview(content),
    setLspStatus: status => this.setLspStatus(status),
    log: (kind, source, message) => this.appendDeveloperLog({ kind, source, message }),
  });
  private readonly webviewStorageController = new WebviewStorageController(() =>
    this.pdfPreviewRunning
    || this.typographyController.fontUpdateInProgress
    || this.projectExportController.isBusy
    || this.settingsController.isLanguageProviderOperationInProgress
    || this.toolchainController.isBusy
    || this.appUpdateController.isInstalling
  );
  private readonly workspaceResumeController = new WorkspaceResumeController({
    canDeferWordWrap: () => Boolean(this.editorInstance) && this.settingsController.value.editor.wordWrap,
    disableWordWrap: () => {
      this.editorInstance.dispatch({ effects: wrapCompartment.reconfigure([]) });
    },
    restoreWordWrap: () => {
      this.editorInstance.dispatch({
        effects: wrapCompartment.reconfigure(
          this.settingsController.value.editor.wordWrap ? EditorView.lineWrapping : []
        )
      });
      this.editorController.refreshLayout("resize completed");
    },
    suspendPreviewResize: () => this.previewFrame.suspendResizeLayout(),
    resumePreviewResize: () => this.previewFrame.resumeResizeLayout(),
    recoverInterruptedResize: () => this.layoutController.recoverInterruptedResize(),
    hasActiveWorkspaceDocument: () => Boolean(this.workspaceRootPath && this.activeFilePath),
    cancelManualForwardSync: () => this.cancelManualForwardSync(),
    resetSourceMap: () => this.sourceMapSessionController.reset(),
    restoreEditorFonts: async () => {
      await this.editorFontManager.ready();
      if (this.editorInstance) this.editorFontManager.updateDocument(this.editorInstance.state.doc.toString());
    },
    rehydratePreviewAndSidebar: () => {
      this.previewFrame.syncTheme();
      if (this.workspaceRootPath) this.sidebarController.applyVisibility();
      this.layoutController.reconcileDockedPaneWidths();
    },
    remeasureWorkspace: reason => {
      this.layoutController.reconcileDockedPaneWidths();
      this.editorInstance?.requestMeasure();
      this.editorController.updateCaretMarker();
      this.editorController.updateDiagnosticMarkers();
      this.previewFrame.syncTheme();
      this.appendDeveloperLog({
        kind: "log",
        source: "editor layout",
        message: `Rehydrated workspace layout after ${reason}.`
      });
    },
    canWarmSourceMap: () => Boolean(
      this.lspReady
      && this.previewFrame.currentUrl
      && this.pdfPreviewGeneration > 0
      && !this.pdfPreviewRunning
    ),
    warmSourceMap: () => this.schedulePdfSourceMapWarmup(this.pdfPreviewGeneration),
    log: (kind, source, message) => this.appendDeveloperLog({ kind, source, message }),
  });
  private readonly pdfPreviewRenderController = new PdfPreviewRenderController({
    previewFrame: this.previewFrame,
    preparation: this.pdfPreviewPreparationController,
    draftPreview: this.draftPreviewController,
    typography: this.typographyController,
    performance: this.performanceController,
    workspaceResume: this.workspaceResumeController,
    previewFailure: this.previewFailureController,
    logConsole: this.logConsoleController,
    getLspClient: () => this.lspClient,
    isLspReady: () => this.lspReady,
    getActiveFilePath: () => this.activeFilePath,
    getPinnedMainFilePath: () => this.pinnedMainFilePath,
    isPreviewImported: () => this.previewImported,
    isPreviewDisabled: () => this.previewDisabled,
    getPreviewRootPath: () => this.previewRootPath,
    getPreviewSessionKey: () => this.previewSessionKey,
    getWorkspaceRootPath: () => this.workspaceRootPath,
    getPreviewRenderMode: () => this.effectivePreviewRenderMode,
    ensureLargePreviewApproved: rootPath => this.ensureLargePreviewApproved(rootPath),
    isPdfBlocked: path => this.blockedLargePdfPaths.has(filePathKey(path)),
    getCacheRootPath: () => this.getCacheRootPath(),
    getEditorText: () => this.editorInstance.state.doc.toString(),
    cancelManualForwardSync: () => this.cancelManualForwardSync(),
    updateManualForwardSyncAction: () => this.updateManualForwardSyncAction(),
    setLspStatus: status => this.setLspStatus(status),
    scheduleSourceMapWarmup: generation => this.schedulePdfSourceMapWarmup(generation),
    recoverTinymistPreviewAfterUnexpectedStop: (contents, generation) =>
      this.recoverTinymistPreviewAfterUnexpectedStop(contents, generation),
    isRenderCachePath: path => this.isRenderCachePath(path),
    mapToOriginalPath: path => this.mapToOriginalPath(path),
    log: (kind, source, message) => this.appendDeveloperLog({ kind, source, message }),
    onRenderSucceeded: () => {
      this.lastFailedPreviewContents = null;
      this.lastPreviewRecoveryRequestedContents = null;
      this.tinymistPreviewRecoveryAttempts = 0;
    },
    onRenderFailed: contents => {
      this.lastFailedPreviewContents = contents;
      this.lastPreviewRecoveryRequestedContents = null;
    },
  });
  private readonly previewSourceNavigationController = new PreviewSourceNavigationController({
    previewSync: this.previewSyncController,
    draftPreview: this.draftPreviewController,
    preparation: this.pdfPreviewPreparationController,
    getEditor: () => this.editorInstance,
    getActiveFilePath: () => this.activeFilePath,
    getOpenTabs: () => this.openTabs,
    getWorkspaceRootPath: () => this.workspaceRootPath,
    getPreviewRootPath: () => this.previewRootPath,
    isPreviewStandalone: () => this.previewStandalone,
    getSourceMapRootPath: () => this.pdfPreviewSourceMapRootPath,
    getActiveMode: () => this.activeMode,
    switchViewLayoutMode: () => this.switchViewLayoutMode(),
    loadFile: (path, options) => this.loadFile(path, options),
    capturePreviewSession: () => this.capturePreviewSession(),
    getActiveTab: () => this.getActiveTab(),
    mapToOriginalPath: path => this.mapToOriginalPath(path),
    isRenderCachePath: path => this.isRenderCachePath(path),
    pdfGeneratedPreviewText: path => this.pdfGeneratedPreviewText(path),
    mapCacheLspPositionToOriginalEditorOffset: (relativePath, position, cacheContent) =>
      this.mapCacheLspPositionToOriginalEditorOffset(relativePath, position, cacheContent),
    editorPositionFromLspPosition: position => this.editorPositionFromLspPosition(position),
    navigateToLogEntry: entry => this.navigateToLogEntry(entry),
    getCacheRootPath: () => this.getCacheRootPath(),
    utf8ByteOffsetToStringOffset: (text, byteOffset) => this.utf8ByteOffsetToStringOffset(text, byteOffset),
    isPreviewOnlyWindow: () => isPreviewOnlyWindow(),
    setPreviewReadyStatus: message => this.setLspStatus({ kind: "preview-ready", message }),
    log: (kind, source, message) => this.appendDeveloperLog({ kind, source, message }),
  });
  private readonly previewUiController = new PreviewUiController({
    previewFrame: this.previewFrame,
    markdownPreviewFrame: this.markdownPreviewFrame,
    draftPreview: this.draftPreviewController,
    imagePreview: this.imagePreviewController,
    getActiveFilePath: () => this.activeFilePath,
    isInternallySupportedPath: path => this.isInternallySupportedPath(path),
    setMarkdownPreviewActive: active => this.setMarkdownPreviewActive(active),
    isDeveloperMode: () => this.settingsController.value.developerMode,
    setLspStatus: status => this.setLspStatus(status),
    log: (kind, source, message) => this.appendDeveloperLog({ kind, source, message }),
  });
  private readonly previewContentController = new PreviewContentController({
    previewFrame: this.previewFrame,
    imagePreview: this.imagePreviewController,
    isImageToolActive: () => this.sidebarController.activeTool === "images",
    getActiveFilePath: () => this.activeFilePath,
    getPinnedMainFilePath: () => this.pinnedMainFilePath,
    getWorkspaceRootPath: () => this.workspaceRootPath,
    getPreviewSessionKey: () => this.previewSessionKey,
    getPreviewRenderMode: () => this.effectivePreviewRenderMode,
    getActiveTab: () => this.getActiveTab(),
    getEditorText: () => this.editorInstance.state.doc.toString(),
    isInternallySupportedPath: path => this.isInternallySupportedPath(path),
    updateActionsToolbar: path => this.updatePreviewActionsToolbar(path),
    prepareTemplateAwarePreview: (target, activePath, contents) =>
      this.prepareTemplateAwarePreview(target, activePath, contents),
    ensureLargePreviewApproved: rootPath => this.ensureLargePreviewApproved(rootPath),
    updatePinnedMain: path => this.updatePinnedMain(path),
    applyPreviewTargetToTab: (tab, target) => this.applyPreviewTargetToTab(tab, target),
    configureDocumentLanguageTools: contents => this.configureDocumentLanguageTools(contents),
    invalidatePreviewWork: reason => this.invalidatePreviewWork(reason),
    renderPdfPreview: contents => this.renderPdfPreview(contents),
    loadPdfPath: (path, identity) => this.loadPdfPath(path, identity),
    setPreviewPaneHtml: html => { this.previewPane.innerHTML = html; },
  });
  private readonly systemResumeMonitor = new SystemResumeMonitor(suspendedMs => {
    void this.workspaceResumeController.recoverAfterSystemResume(suspendedMs);
  });
  private readonly windowStateController = new WindowStateController(getCurrentWindow());
  private lspStatus = document.getElementById("lsp-status")!;
  private lspStatusDot = this.lspStatus.querySelector(".status-dot") as HTMLElement;
  private lspStatusText = this.lspStatus.querySelector(".status-text") as HTMLElement;

  private get effectivePreviewRenderMode(): PreviewRenderMode {
    return this.workspaceMetadata?.workspace.previewRenderMode
      ?? this.settingsController.value.preview.renderMode;
  }

  private async setPreviewRenderMode(mode: PreviewRenderMode): Promise<void> {
    if (!this.workspaceMetadata) {
      this.settingsController.update(settings => {
        settings.preview.renderMode = mode;
      });
      return;
    }
    if (this.workspaceMetadata.workspace.previewRenderMode === mode) return;
    this.workspaceMetadata.workspace.previewRenderMode = mode;
    this.settingsController.setWorkspacePreviewRenderMode(
      mode,
      nextMode => void this.setPreviewRenderMode(nextMode)
    );
    this.applySettingsToRuntime(this.settingsController.value);
    this.draftPreviewController.updateImageHeavyWarning();
    await this.saveWorkspaceState();
  }

  public async bootstrap() {
    const isPreviewWindow = isPreviewOnlyWindow();
    if (isPreviewWindow) {
      await this.bootstrapPreviewWindow();
      return;
    }
    document.documentElement.classList.remove("preview-only-mode");
    document.body.classList.remove("preview-only-mode");

    await this.performanceController.timeStartup("load settings", () => this.settingsController.load());
    await this.performanceController.timeStartup("restore main window", async () => {
      try {
        await this.windowStateController.restore();
      } catch (error) {
        console.warn("Failed to restore the main window state:", error);
      }
    });
    for (const entry of this.settingsController.getTimings()) this.performanceController.recordStartupTimingEntry(entry);
    this.performanceController.timeStartupSync("initialize recent projects", () => this.recentProjectsController.initialize());
    this.performanceController.timeStartupSync("initialize CodeMirror", () => this.initCodeMirror());
    this.performanceController.timeStartupSync("initialize document outline", () => this.documentOutlineController.initialize());
    this.performanceController.timeStartupSync("apply settings to runtime", () => this.applySettingsToRuntime(this.settingsController.value));
    await this.performanceController.timeStartup("load editor fonts", () => this.editorFontManager.ready());
    this.performanceController.timeStartupSync("initialize explorer", () => this.initExplorer());
    this.performanceController.timeStartupSync("initialize editor toolbar", () => this.editorToolbarController.initialize());
    this.performanceController.timeStartupSync("initialize tab strip", () => this.tabStripController.initialize());
    this.performanceController.timeStartupSync("bind global events", () => this.bindGlobalEvents());
    this.performanceController.timeStartupSync("initialize layout", () => this.layoutController.initialize());
    this.performanceController.timeStartupSync("monitor system resume", () => this.systemResumeMonitor.start());
    this.performanceController.timeStartupSync("initialize word wrap label", () => this.initWordWrap());
    this.performanceController.timeStartupSync("initialize invisibles toggle", () => this.initZwsToggle());
    this.performanceController.timeStartupSync("initialize settings panel", () => this.settingsController.initializePanel());
    this.performanceController.timeStartupSync("initialize toolchain UI", () => this.toolchainController.initialize());
    this.performanceController.timeStartupSync("initialize context menu", () => this.contextMenuController.initialize());
    this.performanceController.timeStartupSync("initialize log console", () => this.logConsoleController.initialize());
    this.performanceController.timeStartupSync("update workspace visibility", () => this.updateWorkspaceViewportVisibility());

    await this.performanceController.timeStartup("show main window", () => getCurrentWindow().show());
    this.appUpdateController.initialize();
    this.webviewStorageController.initialize();
    this.editorController.refreshLayout("main window shown");
    this.performanceController.recordStartupTiming("frontend startup", "frontend bootstrap until window shown", this.startupStart);
    this.performanceController.recordFirst({
      name: "startup.usable-editor",
      milliseconds: performance.now() - this.startupStart
    });
    void this.performanceController.logNativeStartupTimings();
    void this.finishStartupInitialization();

    this.setLspStatus({ kind: "starting", message: "Preparing toolchain" });

    let toolchain: ToolchainStatus | null = null;
    try {
      toolchain = await this.performanceController.timeStartup("get toolchain status", () => invoke<ToolchainStatus>("get_toolchain_status"));
    } catch (e) {
      console.error("Failed to check toolchain status:", e);
    }

    if (!toolchain?.tinymistVersion) {
      toolchain = await this.showToolchainSetupDialog();
    }

    this.toolchainController.setStatus(toolchain ?? { typstVersion: null, typstSource: null, tinymistVersion: null, tinymistSource: null, lspAvailable: false, message: "" });
    await this.releaseSummaryController.showIfNeeded();
    await this.performanceController.timeStartup("initialize Tinymist LSP", () => this.initLsp(Boolean(toolchain?.lspAvailable)));
    await this.drainPendingProjectImports();
    this.performanceController.recordStartupTiming("frontend startup", "frontend bootstrap including LSP", this.startupStart);
  }

  private async bootstrapPreviewWindow() {
    document.documentElement.classList.add("preview-only-mode");
    document.body.classList.add("preview-only-mode");

    // The preview window intentionally skips the full workspace bootstrap, but
    // its own toolbar and embedded viewer still need the persisted application
    // theme before the window becomes visible.
    await this.settingsController.load();
    await applyUIThemeVariables(this.settingsController.value.appearance.theme);
    this.previewFrame.syncTheme();
    
    document.getElementById("preview-zoom-in-btn")?.addEventListener("click", () => {
      this.zoomIn();
    });
    document.getElementById("preview-zoom-out-btn")?.addEventListener("click", () => {
      this.zoomOut();
    });
    document.getElementById("preview-zoom-fit-btn")?.addEventListener("click", () => {
      this.zoomToFit();
    });
    this.initializePreviewPageControls();

    const undockBtn = document.getElementById("undock-preview-btn");
    if (undockBtn) {
      undockBtn.title = "Dock Preview";
      undockBtn.addEventListener("click", () => {
        void getCurrentWindow().close();
      });
    }

    const previewWrapper = document.getElementById("preview-container-wrapper");
    if (previewWrapper) {
      previewWrapper.classList.remove("hidden");
      previewWrapper.style.display = "flex";
      previewWrapper.style.width = "100%";
      previewWrapper.style.height = "100%";
    }
    
    await getCurrentWindow().show();

    const { listen, emit } = await import("@tauri-apps/api/event");
    this.initializeUndockedPreviewOptions(action => emit("preview-window-action", action));

    document.getElementById("preview-content-mode-toggle")?.addEventListener("click", () => {
      const requestedMode = this.draftPreviewController.mode === "draft" ? "normal" : "draft";
      this.draftPreviewController.setMode(requestedMode);
      this.draftPreviewController.updateControl(true);
      void emit("preview-content-mode-request", requestedMode);
    });
    
    await listen<ThemeName>("preview-theme-update", (event) => {
      void applyUIThemeVariables(event.payload).then(() => this.previewFrame.syncTheme());
    });

    await listen<string | PdfUpdatePayload>("pdf-update", (event) => {
      const fallbackIdentity = this.pdfPreviewSourceMapRootPath ?? this.previewRootPath ?? "preview";
      const update = typeof event.payload === "string"
        ? {
            path: event.payload,
            identity: fallbackIdentity,
            sessionKey: fallbackIdentity,
            surface: "live" as const
          }
        : event.payload;
      this.draftPreviewController.installPresentedState({
        mode: update.contentMode ?? "normal",
        assets: update.draftAssets ?? [],
        assetRootPath: update.draftAssetRootPath ?? null,
        generation: update.draftThumbnailGeneration ?? 0,
      });
      // Thumbnail status requests are validated against the workspace root.
      // The undocked window has no workspace bootstrap of its own, so inherit
      // the already validated root carried with the Draft manifest.
      this.workspaceRootPath = update.draftAssetRootPath ?? null;
      const contentModeToggle = document.getElementById("preview-content-mode-toggle") as HTMLButtonElement | null;
      contentModeToggle?.classList.remove("hidden");
      void this.loadPdfPath(update.path, update.identity, update.sessionKey, update.surface);
    });

    await listen<{ page_no: number; x: number; y: number }>("pdf-forward-sync", (event) => {
      const pos = event.payload;
      void this.previewFrame?.revealDocumentPosition(pos);
    });

    void emit("preview-window-ready");
  }

  private initializeUndockedPreviewOptions(
    requestMainWindowAction: (action: UndockedPreviewAction) => Promise<void>
  ): void {
    const button = document.getElementById("preview-menu-btn");
    const menu = document.getElementById("context-menu");
    if (!button || !menu) return;

    const hide = () => {
      menu.style.display = "none";
      delete menu.dataset.menuKind;
    };
    const show = () => {
      menu.innerHTML = `
        <div class="dropdown-item" data-preview-action="zoom-out">Zoom Out</div>
        <div class="dropdown-item" data-preview-action="zoom-fit">Fit to Width</div>
        <div class="dropdown-item" data-preview-action="zoom-in">Zoom In</div>
        <div class="dropdown-separator"></div>
        <div class="dropdown-item" data-preview-action="export-pdf">Export PDF</div>
        <div class="dropdown-item" data-preview-action="open-external">Open in External Viewer</div>
        <div class="dropdown-separator"></div>
        <div class="dropdown-item" data-preview-action="dock">Dock Preview</div>`;
      menu.dataset.menuKind = "preview";
      menu.style.display = "block";
      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(0, Math.min(
        buttonRect.right - menuRect.width,
        window.innerWidth - menuRect.width
      ))}px`;
      menu.style.top = `${Math.max(0, Math.min(
        buttonRect.bottom + 4,
        window.innerHeight - menuRect.height
      ))}px`;
    };

    button.addEventListener("click", event => {
      event.stopPropagation();
      if (menu.style.display === "block" && menu.dataset.menuKind === "preview") {
        hide();
      } else {
        show();
      }
    });
    menu.addEventListener("click", event => {
      const action = (event.target as HTMLElement)
        .closest<HTMLElement>("[data-preview-action]")
        ?.dataset.previewAction;
      if (!action) return;
      hide();
      if (action === "zoom-out") this.zoomOut();
      else if (action === "zoom-fit") this.zoomToFit();
      else if (action === "zoom-in") this.zoomIn();
      else if (action === "dock") document.getElementById("undock-preview-btn")?.click();
      else if (action === "export-pdf" || action === "open-external") {
        void requestMainWindowAction(action);
      }
    });
    document.addEventListener("click", hide);
    window.addEventListener("blur", hide);
    window.addEventListener("message", event => {
      const type = (event.data as { type?: unknown } | null)?.type;
      if (type === "HIDE_CONTEXT_MENU" || type === "SHOW_PREVIEW_CONTEXT_MENU") hide();
    });
  }

  private updateWorkspaceViewportVisibility() {
    this.workspaceController.updateViewport({
      activeFilePath: this.activeFilePath,
      workspaceRootPath: this.workspaceRootPath,
      loading: this.workspaceLoading,
    });
  }

  private async navigateToImageReference(reference: ProjectImageReference): Promise<void> {
    this.sidebarController.setTool("explorer");
    if (filePathKey(reference.sourcePath) !== filePathKey(this.activeFilePath ?? "")) {
      await this.loadFile(reference.sourcePath, { focusEditor: false });
    }
    if (!this.getActiveTab()?.contentLoaded) return;
    const from = Math.max(0, Math.min(reference.fromUtf16, this.editorInstance.state.doc.length));
    const to = Math.max(from, Math.min(reference.toUtf16, this.editorInstance.state.doc.length));
    this.editorInstance.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
  }

  private async navigateToImageTool(imagePath: string): Promise<void> {
    this.sidebarController.setTool("images");
    await this.imageToolsController.selectImage(imagePath);
  }

  private async handleImageToolFilesWritten(
    paths: readonly string[],
    phase: "before" | "after",
  ): Promise<void> {
    const keys = paths.map(filePathKey);
    keys.forEach(key => this.managedImageToolPathKeys.add(key));
    window.setTimeout(() => {
      keys.forEach(key => this.managedImageToolPathKeys.delete(key));
    }, phase === "before" ? 10000 : 3000);
    if (phase === "before") return;

    const openFilesChanged = await this.reloadOpenFilesFromDisk(false);
    if (this.workspaceRootPath) await this.explorer.loadWorkspace(this.workspaceRootPath);
    if (openFilesChanged && this.activeFilePath && isTypstDocumentPath(this.activeFilePath)) {
      await this.refreshActivePreviewRoot(true);
    }
  }

  private restoreDefaultLayout(): void {
    if (!this.workspaceRootPath) return;
    this.sidebarController.setVisible(true);

    const explorerSidebar = document.getElementById("explorer-sidebar");
    if (explorerSidebar) explorerSidebar.style.width = `${DEFAULT_EXPLORER_WIDTH_PX}px`;
    this.sidebarController.applyVisibility();

    const inputWrapper = document.getElementById("input-container-wrapper");
    const previewWrapper = document.getElementById("preview-container-wrapper");
    const previewResizer = document.getElementById("editor-preview-resizer");
    const dockButton = document.getElementById("dock-preview-status-btn");

    if (inputWrapper) {
      inputWrapper.style.width = `${DEFAULT_INPUT_WIDTH_PCT}%`;
      this.layoutController.setDockedInputWidthPct(DEFAULT_INPUT_WIDTH_PCT);
      if (this.activeFilePath) inputWrapper.classList.remove("hidden");
    }
    if (previewWrapper) {
      previewWrapper.style.width = `${DEFAULT_PREVIEW_WIDTH_PCT}%`;
      if (this.activeFilePath) {
        previewWrapper.classList.remove("hidden");
        previewWrapper.style.display = "flex";
      } else {
        previewWrapper.style.display = "";
      }
    }
    if (previewResizer) {
      previewResizer.style.display = this.activeFilePath ? "block" : "";
      previewResizer.classList.toggle("hidden", !this.activeFilePath);
    }
    dockButton?.classList.add("hidden");

    const logConsole = document.getElementById("log-console");
    if (logConsole) logConsole.style.height = "";
    this.logConsoleController.setVisible(false);

    this.updateWorkspaceViewportVisibility();
    this.saveWorkspaceState();
  }

  private applySettingsToRuntime(settings: AppSettings) {
    const { appearance, editor, preview } = settings;
    document.documentElement.style.setProperty("--editor-font-size", `${appearance.editorFontSize}px`);
    document.documentElement.style.setProperty("--editor-line-height", String(appearance.editorLineHeight));
    document.documentElement.style.setProperty(
      "--editor-line-height-px",
      `${appearance.editorFontSize * appearance.editorLineHeight}px`,
    );
    this.forwardSyncDebounceMs = preview.syncDebounceMs;
    this.configureAutoSave(editor.autoSave, editor.autoSaveIntervalSeconds);
    this.editorFontManager.configure(editor.codeFont, editor.unicodeFont, editor.unicodeFonts);
    this.spellcheckController.setEnabled(editor.spellcheck);
    this.spellcheckController.setUserDictionary(editor.userDictionary);
    this.spellcheckController.setIgnoredWords(editor.ignoredWords);
    this.spellcheckController.setTerminology(
      editor.globalTerminology,
      this.workspaceMetadata?.project.terminology ?? [],
      editor.languageTerminology,
      editor.scopedIgnoredWords,
    );
    void applyUIThemeVariables(appearance.theme).then(() => this.previewFrame.syncTheme());
    if (!isPreviewOnlyWindow()) {
      import("@tauri-apps/api/event").then(({ emit }) => {
        void emit("preview-theme-update", appearance.theme);
      }).catch(() => {});
    }

    const khmerPrepChanged = this.lastKhmerRenderPrepState !== undefined && this.lastKhmerRenderPrepState !== preview.khmerRenderPreparation;
    this.lastKhmerRenderPrepState = preview.khmerRenderPreparation;
    const renderMode = this.effectivePreviewRenderMode;
    const previewRenderModeChanged = this.lastPreviewRenderMode !== undefined && this.lastPreviewRenderMode !== renderMode;
    this.lastPreviewRenderMode = renderMode;
    if (previewRenderModeChanged && renderMode !== "on-type") {
      this.pdfPreviewRenderController.cancelOnTypeSchedule();
    }

    const khmerPrepStatus = document.getElementById("khmer-prep-status");
    if (khmerPrepStatus) {
      if (preview.khmerRenderPreparation) {
        khmerPrepStatus.classList.remove("hidden");
      } else {
        khmerPrepStatus.classList.add("hidden");
      }
    }

    if (khmerPrepChanged) {
      void this.prepareRenderProjectIfNeeded().then(() => this.refreshActivePreviewRoot());
    } else if (previewRenderModeChanged) {
      void this.refreshActivePreviewRoot();
    }

    if (this.editorInstance) {
      const editorView = this.editorInstance;
      editorView.dispatch({
        effects: this.currentEditorSettingsEffects()
      });
      window.requestAnimationFrame(() => {
        if (this.editorInstance === editorView) editorView.requestMeasure();
      });
    }

    const wrapLabel = document.getElementById("word-wrap-label");
    if (wrapLabel) wrapLabel.textContent = editor.wordWrap ? "Wrap: On" : "Wrap: Off";
    const zwsLabel = document.getElementById("zws-label");
    if (zwsLabel) zwsLabel.textContent = editor.showZws ? "Invisibles: On" : "Invisibles: Off";
    if (!preview.cursorSync) this.previewSyncController.clearForward();
  }

  private currentEditorSettingsEffects() {
    const { appearance, editor } = this.settingsController.value;
    const indentation = " ".repeat(editor.tabSize);
    return [
      themeCompartment.reconfigure(getThemeExtension(appearance.theme)),
      wrapCompartment.reconfigure(editor.wordWrap ? EditorView.lineWrapping : []),
      lineNumbersCompartment.reconfigure(editor.lineNumbers ? lineNumbers() : []),
      activeLineCompartment.reconfigure(editor.highlightActiveLine ? [highlightActiveLineGutter(), highlightActiveLine()] : []),
      closeBracketsCompartment.reconfigure(editor.autoCloseBrackets ? closeBrackets() : []),
      indentationGuidesCompartment.reconfigure(editor.indentationGuides ? visibleIndentationMarkers() : []),
      tabSizeCompartment.reconfigure([EditorState.tabSize.of(editor.tabSize), indentUnit.of(indentation)]),
      showZwsCompartment.reconfigure(editor.showZws ? showZeroWidthSpaces : []),
      completionCompartment.reconfigure(this.editorCompletionForPath(this.activeFilePath ?? ""))
    ];
  }

  private handleLanguageProvidersChanged(providers: Parameters<SpellcheckController["setProviders"]>[0]): void {
    this.spellcheckController.setProviders(providers);
    document.dispatchEvent(new CustomEvent("typsastra:language-providers-changed"));
    if (!this.editorInstance) return;
    this.editorInstance.dispatch({
      effects: completionCompartment.reconfigure(this.editorCompletionForPath(this.activeFilePath ?? ""))
    });
  }

  private initWordWrap() {
    const wrapToggleBtn = document.getElementById("word-wrap-toggle");
    const wrapLabel = document.getElementById("word-wrap-label");
    if (wrapToggleBtn && wrapLabel) {
      wrapLabel.textContent = this.settingsController.value.editor.wordWrap ? "Wrap: On" : "Wrap: Off";
      wrapToggleBtn.addEventListener("click", () => {
        this.settingsController.update(settings => {
          settings.editor.wordWrap = !settings.editor.wordWrap;
        });
      });
    }
  }

  private initZwsToggle() {
    const zwsToggleBtn = document.getElementById("zws-toggle");
    const zwsLabel = document.getElementById("zws-label");
    if (zwsToggleBtn && zwsLabel) {
      zwsLabel.textContent = this.settingsController.value.editor.showZws ? "Invisibles: On" : "Invisibles: Off";
      zwsToggleBtn.addEventListener("click", () => {
        this.settingsController.update(settings => {
          settings.editor.showZws = !settings.editor.showZws;
        });
      });
    }
  }


  private async showToolchainSetupDialog(): Promise<ToolchainStatus | null> {
    return new Promise<ToolchainStatus | null>((resolve) => {
      const overlay = document.getElementById("toolchain-setup-overlay");
      const versionSelect = document.getElementById("toolchain-version-select") as HTMLSelectElement | null;
      const versionHint = document.getElementById("toolchain-version-hint");
      const downloadBtn = document.getElementById("toolchain-download-btn") as HTMLButtonElement | null;
      const exitBtn = document.getElementById("toolchain-exit-btn") as HTMLButtonElement | null;
      const progressContainer = document.getElementById("toolchain-progress-container");
      const progressLabel = document.getElementById("toolchain-progress-label");
      const progressBar = document.getElementById("toolchain-progress-bar") as HTMLElement | null;
      const actions = document.getElementById("toolchain-setup-actions");
      const versionPicker = document.getElementById("toolchain-version-picker");

      if (!overlay || !versionSelect || !downloadBtn || !exitBtn || !progressContainer || !progressBar || !actions || !progressLabel || !versionHint || !versionPicker) {
        resolve(null);
        return;
      }

      overlay.classList.remove("hidden");

      // Fetch available releases and populate the select
      void (async () => {
        try {
          type TinymistRelease = { version: string; publishedAt: string | null };
          const releases = await invoke<TinymistRelease[]>("list_tinymist_releases");
          versionSelect.innerHTML = "";
          const placeholder = document.createElement("option");
          placeholder.value = "";
          placeholder.textContent = "Select a version...";
          versionSelect.appendChild(placeholder);
          for (const release of releases) {
            const opt = document.createElement("option");
            opt.value = release.version;
            opt.textContent = release.version;
            versionSelect.appendChild(opt);
          }
          versionHint.textContent = `${releases.length} stable releases available. The latest is ${releases[0]?.version ?? "unknown"}.`;
        } catch {
          versionSelect.innerHTML = "<option value=\"\">Failed to load releases</option>";
          versionHint.textContent = "Could not reach GitHub. Check your internet connection and try again.";
        }
      })();

      versionSelect.addEventListener("change", () => {
        const hasVersion = Boolean(versionSelect.value);
        downloadBtn.disabled = !hasVersion;
        downloadBtn.style.opacity = hasVersion ? "1" : "0.55";
        downloadBtn.style.cursor = hasVersion ? "pointer" : "default";
      });

      exitBtn.addEventListener("click", () => {
        void getCurrentWindow().close();
      });

      downloadBtn.addEventListener("click", () => {
        const selectedVersion = versionSelect.value;
        if (!selectedVersion) return;

        void (async () => {
          versionPicker.classList.add("hidden");
          actions.classList.add("hidden");
          progressContainer.classList.remove("hidden");

          let progress = 0;
          progressBar.style.width = "0%";
          progressLabel.textContent = `Installing Tinymist ${selectedVersion}...`;

          const progressInterval = window.setInterval(() => {
            if (progress < 15) {
              progress += 2;
              progressLabel.textContent = `Installing Tinymist ${selectedVersion}...`;
            } else if (progress < 55) {
              progress += 1.5;
              progressLabel.textContent = "Downloading Tinymist...";
            } else if (progress < 75) {
              progress += 1;
              progressLabel.textContent = "Verifying embedded Typst compiler...";
            } else if (progress < 93) {
              progress += 0.5;
              progressLabel.textContent = "Finalizing toolchain...";
            }
            progressBar.style.width = String(Math.min(93, progress)) + "%";
          }, 300);

          try {
            const status = await invoke<ToolchainStatus>("install_tinymist_toolchain", { version: selectedVersion });
            window.clearInterval(progressInterval);
            progressBar.style.width = "100%";
            progressLabel.textContent = "Installation complete!";
            await new Promise(r => window.setTimeout(r, 700));
            overlay.classList.add("hidden");
            resolve(status);
          } catch (error) {
            window.clearInterval(progressInterval);
            progressBar.style.width = "0%";
            progressLabel.textContent = "Installation failed. Please try again.";
            await message(String(error), { title: "Toolchain installation failed", kind: "error" });
            progressContainer.classList.add("hidden");
            versionPicker.classList.remove("hidden");
            actions.classList.remove("hidden");
          }
        })();
      });
    });
  }


  private initCodeMirror() {
    const initialDocument = "";
    this.editorFontManager.initialize();
    this.editorExtensions = [
      getEditorExtensions(
        () => this.lspClient,
        () => this.getActiveLspUri(),
        () => this.flushPendingLspSync(),
        (uri, line, character) => void this.navigateToLspLocation(uri, line, character),
        () => this.spellcheckController.getProviders(),
        event => this.appendDeveloperLog({
          kind: "info",
          source: "grapheme pointer",
          message: JSON.stringify(event)
        })
      ),
      this.spellcheckController.extension(),
      EditorView.updateListener.of((update) => {
        const inputProfile = this.editorController.beginInputProfile();
        this.spellcheckController.completionStateChanged(completionStatus(update.state) !== null);
        const wasComposing = this.isComposing;
        this.isComposing = update.view.composing;

        if (update.docChanged && !this.isLoadingFile) {
          this.previewSyncController.clearForward();
          this.markActiveTabDirty();
          if (!update.view.composing) {
            this.scheduleEditorContentMutation(update.state.doc);
            this.spellcheckController.documentChanged(update);
          }
        } else if (!this.isLoadingFile && wasComposing && !update.view.composing) {
          this.scheduleEditorContentMutation(update.state.doc);
          this.spellcheckController.documentChanged(update);
        }
        if (update.selectionSet) {
          this.spellcheckController.selectionChanged(update.docChanged);
          this.syncSelectedSpellingLocation();
          this.documentOutlineController.setCursorPosition(update.state.selection.main.head, this.activeFilePath);
        } else if (update.docChanged) {
          this.logConsoleController.setActiveSpellcheckLocation(null);
        }
        if (update.selectionSet || update.docChanged) {
          this.editorController.updateCursorStatus();
          this.editorController.updateCaretMarker();
        }
        if (update.viewportChanged) {
          this.editorController.updateCaretMarker();
          const topVisiblePosition = update.view.lineBlockAtHeight(update.view.scrollDOM.scrollTop).from;
          this.documentOutlineController.setCursorPosition(topVisiblePosition, this.activeFilePath);
        }
        const diagnosticsChanged = update.transactions.some(transaction =>
          transaction.effects.some(effect =>
            effect.is(setEditorDiagnosticsEffect)
            || effect.is(setImageOptimizationWarningsEffect)
          )
        );

        const currentMatchQuery = editorMatchQuery(update.state);
        const previousMatchQuery = editorMatchQuery(update.startState);
        const matchQueryChanged = currentMatchQuery === null
          ? previousMatchQuery !== null
          : previousMatchQuery === null || !currentMatchQuery.eq(previousMatchQuery);
        
        if (update.docChanged || update.geometryChanged || diagnosticsChanged) {
          this.editorController.updateDiagnosticMarkers();
        }
        if (update.docChanged || update.selectionSet || matchQueryChanged) {
          this.editorController.scheduleMatchMarkers();
        }
        this.editorController.handleFoldTransactions(update.transactions);
        if (!update.docChanged && this.editorController.shouldForwardSyncSelectionUpdate(update)) {
          this.previewSyncController.schedule(this.forwardSyncDebounceMs);
        }
        this.editorController.finishInputProfile(inputProfile, update.state.doc.length, update.view.composing);
      })
    ];
    this.editorInstance = new EditorView({
      state: createTabEditorState({
        doc: initialDocument,
        anchor: 0,
        head: 0,
        extensions: this.editorExtensions
      }),
      parent: this.codeRenderPane
    });

    this.editorController.install(this.editorInstance);

    listen<DraftThumbnailQueueMetric>("draft-thumbnail-queue-metric", event => {
      const metric = event.payload;
      if (!this.isDeveloperLogEnabled("performance")) return;
      if (
        metric.status === "completed"
        && !this.draftPreviewController.acceptsThumbnailMetric(metric.generation)
      ) return;
      this.appendDeveloperLog({
        kind: metric.failed > 0 ? "warning" : "info",
        source: "performance",
        message: `Draft thumbnail cache ${metric.status} (generation ${metric.generation}): ${metric.totalImages} image(s); ${metric.cacheHits} cache hit(s); ${metric.generated} generated; ${metric.failed} failed; ${metric.skipped} skipped; total=${metric.totalMs.toFixed(1)} ms; decode=${metric.decodeMs.toFixed(1)} ms; resize=${metric.resizeMs.toFixed(1)} ms; encode=${metric.encodeMs.toFixed(1)} ms; output=${(metric.outputBytes / 1024 / 1024).toFixed(2)} MiB.`
      });
    });
    // The editor remains mouse- and command-focusable, but ordinary Tab
    // navigation between application controls must never land in source text.
    this.editorInstance.contentDOM.tabIndex = -1;
    this.editorFontManager.updateDocument(initialDocument);
    this.editorController.updateCursorStatus();
    this.editorController.updateAll();
  }

  private initExplorer() {
    this.explorer = new WorkspaceExplorer(
      document.getElementById("workspace-explorer-tree")!,
      (path: string, options?: { temporary?: boolean; focusEditor?: boolean }) => {
        void this.loadFile(path, options);
      },
      (path: string) => this.isPinnedMainFile(path),
      document.getElementById("workspace-explorer-title")!
    );
  }

  private renderEditorTabs(): void {
    this.editorTabViewController.render();
  }

  private async promoteToPermanent(tab: EditorTab) {
    if (!tab.temporary) return;
    tab.temporary = false;
    this.renderEditorTabs();
    this.saveWorkspaceState();
  }

  private getActiveTab(): EditorTab | null {
    return this.editorSessionController.activeTab;
  }

  private persistActiveTabState() {
    if (this.workspaceLoading) return;
    this.flushEditorContentMutation();
    const tab = this.getActiveTab();
    if (!tab || !tab.contentLoaded || !this.editorInstance) return;
    if (!this.isInternallySupportedPath(tab.path) || isBinaryImagePath(tab.path) || fileExtension(tab.path) === "pdf") return;

    const content = this.activeMode === "WYSIWYM"
      ? this.mapWysiwymToMarkup()
      : this.editorInstance.state.doc.toString();
    const selection = this.editorInstance.state.selection.main;
    tab.content = content;
    tab.isDirty = tab.content !== tab.savedContent;
    tab.version = this.currentVersion;
    tab.latestVersion = this.latestDocumentVersion;
    tab.selectionAnchor = selection.anchor;
    tab.selectionHead = selection.head;
    tab.scrollTop = this.editorInstance.scrollDOM.scrollTop;
    tab.scrollLeft = this.editorInstance.scrollDOM.scrollLeft;
    tab.scrollSnapshot = this.editorInstance.scrollSnapshot();
    tab.foldRanges = tab.foldStateExplicit ? this.collectCurrentFoldRanges() : [];
    tab.undoHistory = captureEditorUndoHistory(this.editorInstance.state);
  }

  private collectCurrentFoldRanges(): EditorFoldRange[] {
    return this.editorController.collectFoldRanges();
  }

  private restoreEditorTabViewport(tab: EditorTab, path: string): void {
    if (tab.scrollSnapshot) {
      // A CodeMirror snapshot retains the top document anchor as well as its
      // pixel offset. Unlike assigning scrollTop directly, it remains stable
      // while the newly activated document's virtual line geometry settles.
      this.editorInstance.dispatch({ effects: tab.scrollSnapshot });
      return;
    }

    if (tab.scrollTop === undefined && tab.scrollLeft === undefined) return;
    const restoredPath = path;
    const targetScrollTop = tab.scrollTop ?? 0;
    const targetScrollLeft = tab.scrollLeft ?? 0;
    const editor = this.editorInstance;
    const restoreKey = { restoredPath };
    const scheduleRestore = () => {
      editor.requestMeasure({
        key: restoreKey,
        read: () => null,
        write: () => {
          if (
            this.editorInstance !== editor
            || !this.activeFilePath
            || filePathKey(this.activeFilePath) !== filePathKey(restoredPath)
          ) return;
          editor.scrollDOM.scrollTop = targetScrollTop;
          editor.scrollDOM.scrollLeft = targetScrollLeft;
        },
      });
    };

    // Workspace-restored tabs do not have an in-memory snapshot. Restore their
    // serialized offsets once immediately and once after the first viewport
    // draw so CodeMirror cannot overwrite them with provisional geometry.
    scheduleRestore();
    requestAnimationFrame(scheduleRestore);
  }

  private restoreTabFoldState(tab: EditorTab) {
    tab.foldRanges = this.editorController.restoreFoldState(
      tab.foldStateExplicit,
      tab.foldRanges,
    );
  }

  private activateSpellcheckDocument(path: string | null): void {
    this.configureDocumentLanguageTools(path ? this.editorInstance.state.doc.toString() : "");
    this.spellcheckController.activateDocument(path ? filePathKey(path) : "");
  }

  private configureDocumentLanguageTools(text: string): void {
    const activeEntries = parseDocumentScripts(text);
    const activeOwnsDocumentConfiguration = !this.pinnedMainFilePath
      || (this.activeFilePath !== null && this.isPinnedMainFile(this.activeFilePath));
    if (activeOwnsDocumentConfiguration) this.mainDocumentScripts = activeEntries;
    const entries = documentScriptsForPreviewContext(
      this.activeFilePath,
      this.pinnedMainFilePath,
      this.previewImported,
      activeEntries,
      this.mainDocumentScripts
    );
    this.documentLanguageService.configure(entries);
    this.spellcheckController.setDocumentScripts(entries);
  }

  private scheduleDocumentOutlineUpdate(path: string, delay = 180): void {
    if (this.documentOutlineUpdateTimer !== null) {
      window.clearTimeout(this.documentOutlineUpdateTimer);
    }
    const generation = ++this.documentOutlineUpdateGeneration;
    // Outline parsing scans the full source and may resolve included files.
    // Wait until typing pauses so it never blocks CodeMirror's input update.
    this.documentOutlineUpdateTimer = window.setTimeout(() => {
      this.documentOutlineUpdateTimer = null;
      const activeTab = this.getActiveTab();
      if (
        generation !== this.documentOutlineUpdateGeneration
        || !activeTab
        || filePathKey(activeTab.path) !== filePathKey(path)
      ) return;
      void this.documentOutlineController.update(
        path,
        activeTab.content,
        this.workspaceRootPath || "",
        async candidatePath => {
          try {
            return await invoke<string>("read_workspace_file", { path: candidatePath });
          } catch {
            return null;
          }
        }
      );
    }, delay);
  }

  private foldCurrentFile(): void {
    if (!this.getActiveTab() || !this.isInternallySupportedPath(this.activeFilePath ?? "") || isBinaryImagePath(this.activeFilePath ?? "") || fileExtension(this.activeFilePath ?? "") === "pdf") return;
    const tab = this.getActiveTab();
    if (tab) tab.foldStateExplicit = true;
    this.editorController.foldDocument();
  }

  private unfoldCurrentFile(): void {
    if (!this.getActiveTab() || !this.isInternallySupportedPath(this.activeFilePath ?? "") || isBinaryImagePath(this.activeFilePath ?? "") || fileExtension(this.activeFilePath ?? "") === "pdf") return;
    const tab = this.getActiveTab();
    if (tab) tab.foldStateExplicit = true;
    this.editorController.unfoldDocument();
  }

  private applyFoldRanges(ranges: EditorFoldRange[]) {
    this.editorController.applyFoldRanges(ranges);
  }

  private normalizeFoldRanges(value: unknown, docLength: number): EditorFoldRange[] {
    return this.editorController.normalizeFoldRanges(value, docLength);
  }

  private updateActiveTabContent(content: string) {
    const tab = this.getActiveTab();
    if (!tab) return;

    const wasDirty = tab.isDirty;
    tab.content = content;
    tab.isDirty = tab.content !== tab.savedContent;
    
    if (tab.isDirty && tab.temporary) {
      void this.promoteToPermanent(tab);
    } else if (wasDirty !== tab.isDirty) {
      this.renderEditorTabs();
    }
  }

  private markActiveTabDirty(): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    const wasDirty = tab.isDirty;
    tab.isDirty = true;
    if (tab.temporary) {
      void this.promoteToPermanent(tab);
    } else if (!wasDirty) {
      this.renderEditorTabs();
    }
  }

  private scheduleEditorContentMutation(doc: Text): void {
    if (!this.activeFilePath) return;
    this.editorController.scheduleContentMutation(this.activeFilePath, doc);
  }

  private flushEditorContentMutation(previewDebounceElapsedMs = 0): void {
    this.editorController.flushContentMutation(
      this.activeFilePath,
      previewDebounceElapsedMs,
    );
  }

  private async renameWorkspacePath(
    oldPath: string,
    newPath: string,
    updateImageReferences = false,
  ): Promise<void> {
    const workspaceRoot = this.workspaceRootPath;
    const imageReferenceSourcePaths = updateImageReferences
      ? this.imageToolsController.referenceSourcePathsForImage(oldPath)
      : [];
    if (workspaceRoot) this.workspaceController.stopWatching();
    if (imageReferenceSourcePaths.length > 0) {
      await this.handleImageToolFilesWritten(imageReferenceSourcePaths, "before");
    }

    try {
      await invoke("rename_workspace_file", { oldPath, newPath });

      if (workspaceRoot && imageReferenceSourcePaths.length > 0) {
        try {
          await invoke<number>("image_tool_update_references", {
            workspaceRootPath: workspaceRoot,
            originalImagePath: oldPath,
            replacementImagePath: newPath,
            sourcePaths: imageReferenceSourcePaths,
          });
          // Keep open source tabs synchronized before preparing the next
          // preview generation, otherwise it can briefly compile the stale
          // image path that existed before the rename.
          await this.reloadOpenFilesFromDisk(false);
        } catch (error) {
          this.appendDeveloperLog({
            kind: "error",
            source: "image tools",
            message: `The image was renamed, but its static Typst references could not be updated: ${String(error)}`,
          });
        }
      }

      const renamedTabs: Array<{ oldPath: string; tab: EditorTab }> = [];
      for (const tab of this.openTabs) {
        const renamedPath = remapFilePath(tab.path, oldPath, newPath);
        if (renamedPath === tab.path) continue;

        renamedTabs.push({ oldPath: tab.path, tab });
        this.typographyController.renameDocument(tab.path, renamedPath);
        tab.path = renamedPath;
      }

      this.activeFilePath = this.activeFilePath
        ? remapFilePath(this.activeFilePath, oldPath, newPath)
        : null;
      this.pinnedMainFilePath = this.pinnedMainFilePath
        ? remapFilePath(this.pinnedMainFilePath, oldPath, newPath)
        : null;
      this.documentSessionController.remapPendingSyncPath(path =>
        remapFilePath(path, oldPath, newPath)
      );

      // Preview roots and task identities include the source path. Keeping any
      // of them after a rename lets stale and current sessions alternate.
      for (const tab of this.openTabs) {
        tab.previewRootPath = null;
        tab.previewMainPath = null;
        tab.previewTaskId = null;
        tab.previewSessionKey = null;
        tab.previewImported = false;
        tab.previewStandalone = true;
        tab.previewDisabled = false;
      }
      this.previewRootPath = null;
      this.previewMainPath = null;
      this.previewTaskId = null;
      this.previewSessionKey = null;
      this.previewImported = false;
      this.previewStandalone = true;
      this.previewDisabled = false;
      this.pinnedLspMainPath = null;
      this.pdfPreviewPreparationController.clearGeneratedFiles();
      this.pdfPreviewRenderController.invalidatePreparationScheduleOnly();

      if (this.activeFilePath) {
        this.explorer.setActiveFile(this.activeFilePath);
        this.activateSpellcheckDocument(this.activeFilePath);
      }
      this.editorSessionController.sortPinnedMainFirst(this.pinnedMainFilePath);
      this.renderEditorTabs();
      await this.saveWorkspaceState();

      if (this.lspReady && this.lspClient) {
        try {
          for (const renamed of renamedTabs) {
            const oldUri = filePathToUri(renamed.oldPath);
            if (this.openedDocumentUris.delete(oldUri)) {
              await this.lspClient.closeTextDocument(oldUri).catch(() => {});
            }
            if (!isTypstDocumentPath(renamed.tab.path)) continue;
            const newUri = filePathToUri(renamed.tab.path);
            await this.lspClient.openTextDocument(newUri, renamed.tab.content, renamed.tab.version);
            this.openedDocumentUris.add(newUri);
          }
          await this.lspClient.notifyWorkspaceFilesChanged([
            { uri: filePathToUri(oldPath), type: 3 },
            { uri: filePathToUri(newPath), type: 1 }
          ]);
        } catch (error) {
          this.appendDeveloperLog({
            kind: "warning",
            source: "workspace",
            message: `The file was renamed, but Tinymist's document state could not be transferred: ${String(error)}`
          });
        }
      }

      await this.prepareRenderProjectIfNeeded();
      await this.refreshActivePreviewRoot(true);
      if (imageReferenceSourcePaths.length > 0) {
        await this.handleImageToolFilesWritten(imageReferenceSourcePaths, "after");
      }
    } finally {
      if (workspaceRoot && this.workspaceRootPath === workspaceRoot) {
        await this.workspaceController.startWatching(workspaceRoot);
      }
    }
  }

  private async closeEditorTab(path: string, skipDirtyCheck = false) {
    if (this.pinnedMainFilePath && filePathKey(path) === filePathKey(this.pinnedMainFilePath)) {
      return;
    }
    const tabIndex = this.openTabs.findIndex((tab) => tab.path === path);
    if (tabIndex === -1) return;

    if (this.activeFilePath === path) {
      this.persistActiveTabState();
    }

    const tab = this.openTabs[tabIndex];
    if (!skipDirtyCheck && tab.isDirty) {
      const shouldClose = await confirm(
        `Close ${fileNameFromPath(tab.path)} without saving?`,
        { title: "Unsaved Changes", kind: "warning" }
      );
      if (!shouldClose) {
        return;
      }
    }

    const wasActive = this.activeFilePath === path;
    this.openTabs.splice(tabIndex, 1);
    this.typographyController.closeDocument(path);
    await this.closeDocumentIfOpened(path);

    if (wasActive) {
      const nextTab = this.openTabs[Math.min(tabIndex, this.openTabs.length - 1)] ?? null;
      this.activeFilePath = null;
      this.previewRootPath = null;
      this.previewMainPath = null;
      this.previewTaskId = null;
      this.previewSessionKey = null;
      this.previewImported = false;
      this.previewStandalone = true;
      this.previewDisabled = false;
      this.clearDiagnostics();
      this.clearPendingLspSync();
      this.previewSyncController.clearForward();

      if (nextTab) {
        await this.activateEditorTab(nextTab.path, false);
      } else {
        this.explorer.setActiveFile(null);
        this.activateSpellcheckDocument(null);
        this.isLoadingFile = true;
        try {
          this.editorInstance.setState(createTabEditorState({
            doc: "",
            anchor: 0,
            head: 0,
            extensions: this.editorExtensions,
          }));
          this.editorInstance.dispatch({ effects: this.currentEditorSettingsEffects() });
          this.applyFoldRanges([]);
        } finally {
          this.isLoadingFile = false;
        }
        this.previewPane.innerHTML = "";
        this.previewFrame.clear();
        this.editorFontManager.updateDocument("");
        this.documentOutlineController.clear();
        if (this.activeMode === "WYSIWYM") {
          this.mapMarkupToWysiwym("");
        }
      }
    }

    this.renderEditorTabs();
    this.updateWorkspaceViewportVisibility();
    this.saveWorkspaceState();
  }

  private async largeFileNoticeForTab(tab: EditorTab) {
    if (tab.sizeBytes === undefined) {
      try {
        tab.sizeBytes = await invoke<number>("workspace_file_size", { path: tab.path });
      } catch {
        return null;
      }
    }
    const sizeNotice = largeFileOpeningNotice(tab.path, tab.sizeBytes);
    if (sizeNotice?.kind === "pdf" || fileExtension(tab.path) === "pdf" || isBinaryImagePath(tab.path) || !this.isInternallySupportedPath(tab.path)) {
      return sizeNotice;
    }
    if (!sizeNotice && tab.lineCount === undefined) {
      try {
        tab.lineCount = await invoke<number>("workspace_text_line_count", { path: tab.path });
      } catch {
        return null;
      }
    }
    const textNotice = sizeNotice ?? largeFileOpeningNotice(tab.path, tab.sizeBytes, tab.lineCount);
    if (textNotice || !isTypstDocumentPath(tab.path)) return textNotice;

    const target = await this.previewTargetForUnloadedTab(tab);
    if (!target?.rootPath || target.disabled) return null;
    return this.largePreviewNoticeForRoot(target.rootPath);
  }

  private async previewTargetForUnloadedTab(tab: EditorTab): Promise<PreviewTarget | null> {
    if (!isTypstDocumentPath(tab.path)) return null;
    try {
      return await invoke<PreviewTarget>("resolve_preview_main", {
        filePath: tab.path,
        workspaceRootPath: this.workspaceRootPath,
        fileContents: tab.contentLoaded ? tab.content : null,
        pinnedMainPath: this.pinnedMainFilePath
      });
    } catch {
      return null;
    }
  }

  private async approveLargePreviewForTab(tab: EditorTab, notice: LargeFileOpeningNotice): Promise<void> {
    const target = notice.previewRootPath
      ? { rootPath: notice.previewRootPath }
      : await this.previewTargetForUnloadedTab(tab);
    const rootPath = target?.rootPath;
    if (!rootPath) return;
    const rootKey = filePathKey(rootPath);
    this.approvedLargePreviewRoots.add(rootKey);
    this.inspectedPreviewRoots.add(rootKey);
    if (this.blockedLargePreviewRoot) {
      const blockedKey = filePathKey(this.blockedLargePreviewRoot);
      if (blockedKey === rootKey || blockedKey === filePathKey(tab.path)) {
        this.blockedLargePreviewRoot = null;
      }
    }
  }

  private activeCompilerPreviewMatchesRoot(rootPath: string): boolean {
    const activeRootMatches = [this.previewRootPath, this.previewMainPath]
      .some(path => path !== null && filePathKey(path) === filePathKey(rootPath));
    const mountedSessionMatches = Boolean(
      this.previewSessionKey
      && this.previewFrame.currentSessionKey === this.previewSessionKey
      && this.previewFrame.currentUrl
    );
    const lspAlreadyOwnsRoot = Boolean(
      this.lspReady
      && this.pinnedLspMainPath
      && filePathKey(this.pinnedLspMainPath) === filePathKey(rootPath)
    );
    return lspAlreadyOwnsRoot || (activeRootMatches && mountedSessionMatches);
  }

  private async largePreviewNoticeForRoot(rootPath: string): Promise<LargeFileOpeningNotice | null> {
    try {
      const stats = await invoke<{ sizeBytes: number; lineCount: number; fileCount: number }>(
        "typst_preview_source_stats",
        { rootPath }
      );
      return largeMainPreviewOpeningNotice(
        rootPath,
        stats.sizeBytes,
        stats.lineCount,
        stats.fileCount
      );
    } catch {
      return null;
    }
  }

  private async ensureLargePreviewApproved(rootPath: string | null): Promise<boolean> {
    if (!rootPath || this.activeCompilerPreviewMatchesRoot(rootPath)) return true;
    const rootKey = filePathKey(rootPath);
    if (this.approvedLargePreviewRoots.has(rootKey)) return true;
    if (this.inspectedPreviewRoots.has(rootKey)) return true;
    if (this.blockedLargePreviewRoot && filePathKey(this.blockedLargePreviewRoot) === rootKey) return false;
    const notice = await this.largePreviewNoticeForRoot(rootPath);
    if (!notice) {
      this.inspectedPreviewRoots.add(rootKey);
      return true;
    }

    this.blockedLargePreviewRoot = rootPath;
    this.workspaceServicesDeferredForLargeFile = true;
    const activeTab = this.getActiveTab();
    if (activeTab) {
      this.showLargeFileConfirmation(activeTab, notice);
    } else {
      this.previewFrame.setMessage(
        `<div class="preview-disabled-placeholder guardrail-paired-placeholder">` +
        `<div class="guardrail-placeholder-content">` +
        `<div class="preview-disabled-title">Preview Waiting for File Approval</div>` +
        `<div class="preview-disabled-msg">Open the large Typst file in the editor to start its compiler preview.</div>` +
        `</div></div>`
      );
    }
    return false;
  }

  private async loadEditorTabContent(tab: EditorTab): Promise<void> {
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
    tab.foldRanges = tab.foldRanges === null
      ? null
      : this.normalizeFoldRanges(tab.foldRanges, contents.length);
  }

  private isInternallySupportedPath(path: string): boolean {
    return isSupportedInAppPath(path) || this.detectedPlainTextPaths.has(filePathKey(path));
  }

  private editorLanguageForPath(path: string): Extension {
    if (isTypstDocumentPath(path)) return typstLanguage;
    if (isMarkdownDocumentPath(path)) return this.markdownEditorLanguage;
    return [];
  }

  private editorCompletionForPath(path: string): Extension {
    if (!isTypstDocumentPath(path)) return [];
    const editor = this.settingsController.value.editor;
    return createTypstAutocomplete(
      () => this.lspClient,
      () => this.getActiveLspUri(),
      () => this.flushPendingLspSync(),
      editor.wordCompletion,
      () => this.spellcheckController.getProviders(),
      providers => this.documentLanguageService.completionProvider(providers),
      () => this.documentLanguageService.currentGeneration(),
      milliseconds => this.performanceController.record({ name: "language.completion", milliseconds }),
      message => this.appendDeveloperLog({ kind: "info", source: "lsp autocomplete", message }),
      () => this.settingsController.value.editor.userDictionary,
    );
  }

  private async resolveMarkdownWorkspacePath(documentPath: string, reference: string): Promise<string | null> {
    if (!this.workspaceRootPath || !reference || reference.startsWith("#")) return null;
    if (/^(?:data:|https?:|mailto:)/iu.test(reference)) return null;
    const pathOnly = reference.split(/[?#]/u, 1)[0];
    if (!pathOnly) return null;
    let decoded = pathOnly;
    try {
      decoded = decodeURIComponent(pathOnly);
    } catch {
      return null;
    }
    const absolute = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(decoded)
      ? decoded
      : await join(await dirname(documentPath), decoded);
    return relativeFilePath(this.workspaceRootPath, absolute) === null ? null : absolute;
  }

  private async resolveMarkdownImage(documentPath: string, source: string): Promise<MarkdownResource | null> {
    const path = await this.resolveMarkdownWorkspacePath(documentPath, source);
    if (!path || (!isBinaryImagePath(path) && fileExtension(path) !== "svg")) return null;
    const mimeType = ({
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      avif: "image/avif",
      bmp: "image/bmp",
      ico: "image/x-icon",
      svg: "image/svg+xml",
    } as Record<string, string>)[fileExtension(path)];
    if (!mimeType) return null;
    const base64 = await invoke<string>("read_workspace_file_as_base64", { path });
    return {
      source: `data:${mimeType};base64,${base64}`,
      alt: fileNameFromPath(path),
    };
  }

  private async openMarkdownLink(documentPath: string, href: string): Promise<void> {
    if (/^(?:https?:|mailto:)/iu.test(href)) {
      await openUrl(href);
      return;
    }
    const path = await this.resolveMarkdownWorkspacePath(documentPath, href);
    if (path) await this.loadFile(path);
  }

  private setMarkdownPreviewActive(active: boolean): void {
    document.getElementById("preview-container-wrapper")?.classList.toggle("markdown-preview-active", active);
  }

  private async classifyUnknownTextPath(path: string): Promise<boolean> {
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

  private async activateEditorTab(path: string, persistCurrent = true, options: ActivateEditorTabOptions = {}) {
    this.explorer.setActiveFile(path);
    if (this.workspaceRootPath) {
      // Revealing may rescan expanded directories. It must not delay the tab
      // highlight or editor swap; the explorer generation guard ensures only
      // the latest requested reveal commits.
      void this.explorer.revealPath(path);
    }
    const tab = this.openTabs.find((candidate) => filePathKey(candidate.path) === filePathKey(path));
    const sameActivePath = this.activeFilePath !== null && filePathKey(this.activeFilePath) === filePathKey(path);
    if (tab && !isSupportedInAppPath(tab.path) && await this.classifyUnknownTextPath(tab.path)) {
      // Restored unknown tabs begin as lightweight external-file descriptors.
      // Once their content is identified as text, defer loading it through the
      // same large-file guard and text-editor path as a known text extension.
      if (!tab.content && !tab.savedContent) tab.contentLoaded = false;
    }
    if (tab && !tab.contentLoaded) {
      const notice = await this.largeFileNoticeForTab(tab);
      if (notice && !options.largeFileConfirmed) {
        if (persistCurrent && !sameActivePath) this.persistActiveTabState();
        this.showLargeFileConfirmation(tab, notice);
        return;
      }
      await this.loadEditorTabContent(tab);
    }
    this.clearGuardrailAlignment();
    const activeEditorMatchesTab = tab !== undefined && (
      !this.isInternallySupportedPath(tab.path) ||
      isBinaryImagePath(tab.path) ||
      fileExtension(tab.path) === "pdf" ||
      this.editorInstance.state.doc.toString() === tab.content
    );
    if (sameActivePath && tab && activeEditorMatchesTab && !options.largeFileConfirmed) {
      if (isMarkdownDocumentPath(tab.path)) {
        this.setMarkdownPreviewActive(true);
        this.markdownPreviewFrame.activate(tab.path, tab.content);
        this.updatePreviewActionsToolbar(tab.path);
      }
      if (persistCurrent) {
        this.persistActiveTabState();
        this.renderEditorTabs();
      }
      if (options.preservePreviewSession) {
        const tab = this.getActiveTab();
        if (tab) this.applyPreviewSessionToTab(tab, options.preservePreviewSession);
        if (options.preservePreviewSession.previewSessionKey) {
          this.previewFrame.activateSession(options.preservePreviewSession.previewSessionKey);
        }
      }
      if (options.focusEditor !== false) this.editorInstance.focus();
      this.saveWorkspaceState();
      return;
    }

    if (persistCurrent && !sameActivePath) {
      this.persistActiveTabState();
    }
    if (!sameActivePath) this.cancelManualForwardSync();

    if (!tab) {
      if (sameActivePath) {
        this.activeFilePath = null;
      }
      this.updateManualForwardSyncAction();
      return;
    }

    path = tab.path;
    const isTypstDocument = isTypstDocumentPath(path);
    const isMarkdownDocument = isMarkdownDocumentPath(path);
    if (!isMarkdownDocument) {
      this.markdownPreviewFrame.deactivate();
      this.setMarkdownPreviewActive(false);
    }
    this.typographyController.setAcceptedFonts(
      path,
      this.typographyController.fromText(tab.content)?.fonts ?? [],
    );
    this.currentVersion = tab.version;
    this.latestDocumentVersion = tab.latestVersion;
    this.previewSyncController.reset();
    this.clearEditorDiagnostics();

    this.isLoadingFile = true;
    try {
      const codeRenderPane = document.getElementById("code-render-pane");
      const imageViewerPane = document.getElementById("image-viewer-pane");
      const imageViewerImg = document.getElementById("image-viewer-img") as HTMLImageElement;

      const unsupportedFile = !this.isInternallySupportedPath(path);
      const isPdf = fileExtension(path) === "pdf";
      if (unsupportedFile || isBinaryImagePath(path) || isPdf) {
        codeRenderPane?.classList.add("hidden");
        imageViewerPane?.classList.remove("hidden");
        if (imageViewerImg) imageViewerImg.style.display = "none"; // Hide image element in editor
        
        this.renderNonTextEditorPlaceholder(path, unsupportedFile);
        document.getElementById("wysiwym-editor-pane")?.classList.add("hidden");

        this.imagePreviewController.clear();

        this.activateSpellcheckDocument(null);
        this.documentOutlineController.clear();
        if (!options.skipPreviewActivation) {
          this.updatePreviewActionsToolbar(path);
          if (isBinaryImagePath(path)) {
            this.renderInteractiveImageViewer(tab.content);
          } else if (isPdf) {
            void this.loadPdfPath(path, path);
          } else {
            this.previewFrame.setMessage(
              `<div class="preview-disabled-placeholder">` +
              `<div class="preview-disabled-title">Preview Unavailable</div>` +
              `<div class="preview-disabled-msg">Open this file with its system application to view it.</div>` +
              `</div>`
            );
          }
        }
        this.editorToolbarController.setDisabled(true);
        this.activeFilePath = path;
        this.draftPreviewController.publishWarnings();
        this.isLoadingFile = false;
        this.updateManualForwardSyncAction();
        this.updateWorkspaceViewportVisibility();
        this.renderEditorTabs();
        this.saveWorkspaceState();
        this.resumeDeferredWorkspaceServices();
        return;
      } else {
        this.imagePreviewController.clear();

        this.updatePreviewActionsToolbar(path);
        codeRenderPane?.classList.remove("hidden");
        imageViewerPane?.classList.add("hidden");
        if (imageViewerImg) imageViewerImg.style.display = "block"; // Reset styling
        if (this.activeMode === "WYSIWYM") {
          document.getElementById("wysiwym-editor-pane")?.classList.remove("hidden");
        }
        
        const ext = path.split('.').pop()?.toLowerCase();
        if (ext === "typ") {
          this.editorToolbarController.setDisabled(false);
        } else {
          this.editorToolbarController.setDisabled(true);
          if (ext === "md" || ext === "markdown") {
            // Markdown owns an overlay renderer. Leave the persistent PDF
            // presentation underneath untouched so returning to Typst is instant.
          } else if (ext === "svg") {
            this.previewFrame.setMessageOverlay(
              `<div style="display:flex;align-items:center;justify-content:center;height:100%;width:100%;background:var(--ui-bg);box-sizing:border-box;padding:20px;overflow:auto;">` +
              tab.content +
              `</div>`
            );
          } else {
            this.previewFrame.setMessageOverlay(
              `<div class="preview-disabled-placeholder">` +
              `<div class="preview-disabled-icon">🚫</div>` +
              `<div class="preview-disabled-title">Preview Unavailable</div>` +
              `<div class="preview-disabled-msg">Live preview is not supported for ${ext?.toUpperCase() || "this"} files.</div>` +
              `</div>`
            );
          }
        }
      }

      // Apply the destination document's script-aware font stack before its
      // text becomes visible. Updating it later allows one paint with the
      // previous tab's fallback stack, which is especially noticeable for
      // Khmer text.
      const editorFontEffect = this.editorFontManager.prepareDocument(tab.content);
      this.editorInstance.setState(createTabEditorState({
        doc: tab.content,
        anchor: tab.selectionAnchor,
        head: tab.selectionHead,
        extensions: this.editorExtensions,
        undoHistory: tab.undoHistory,
      }));
      this.editorInstance.dispatch({
        effects: [
          ...this.currentEditorSettingsEffects(),
          ...(editorFontEffect ? [editorFontEffect] : []),
          languageCompartment.reconfigure(this.editorLanguageForPath(path)),
          completionCompartment.reconfigure(this.editorCompletionForPath(path)),
        ]
      });
    } finally {
      this.isLoadingFile = false;
    }
    this.restoreTabFoldState(tab);
    // Commit the visible tab selection before resolving typography through a
    // potentially unloaded template file.
    this.activeFilePath = path;
    if (isMarkdownDocument) {
      this.setMarkdownPreviewActive(true);
      this.markdownPreviewFrame.activate(path, tab.content);
    }
    this.draftPreviewController.publishWarnings();
    this.renderEditorTabs();
    this.restoreEditorTabViewport(tab, path);
    const activeTypography = await this.typographyController.effective(path, tab.content);
    if (activeTypography) {
      this.editorToolbarController.synchronizeDocumentTypography(activeTypography);
    }

    if (path.toLowerCase().endsWith(".typ")) this.diagnosticWaitStartedAt = performance.now();
    let previewPresentationReused = false;
    let previewGuarded = false;
    let previewTarget: PreviewTarget | null = null;
    if (options.skipPreviewActivation) {
      // Restore editor/tab state first. Preview and LSP setup will run when the
      // toolchain reports readiness, avoiding startup-time restore failures.
    } else if (options.preservePreviewSession) {
      this.applyPreviewSessionToTab(tab, options.preservePreviewSession);
      if (options.preservePreviewSession.previewSessionKey) {
        previewPresentationReused = this.previewFrame.activateSession(options.preservePreviewSession.previewSessionKey);
      }
    } else if (!isTypstDocument) {
      // Non-Typst text files remain editor-only. Their preview placeholder was
      // selected above and they must never be resolved as compiler roots.
    } else if (!this.pinnedMainFilePath) {
      this.previewFrame.setMessage(this.noMainFileMessage());
    } else {
      previewTarget = await invoke<PreviewTarget>("resolve_preview_main", {
        filePath: path,
        workspaceRootPath: this.workspaceRootPath,
        fileContents: tab.content,
        pinnedMainPath: this.pinnedMainFilePath
      });
      if (previewTarget.disabled) {
        this.applyPreviewTargetToTab(tab, previewTarget);
        this.invalidatePreviewWork(`${path} does not participate in the configured main preview`);
      } else {
        previewTarget = await this.prepareTemplateAwarePreview(previewTarget, path, tab.content);
        previewGuarded = !(await this.ensureLargePreviewApproved(previewTarget.rootPath));
        if (previewGuarded) {
          this.applyPreviewTargetToTab(tab, previewTarget);
        } else {
          const existingMainSession = this.captureCurrentMainSessionForImportedTarget(previewTarget);
          if (existingMainSession) {
            this.applyPreviewSessionToTab(tab, existingMainSession);
            if (existingMainSession.previewSessionKey) {
              previewPresentationReused = this.previewFrame.activateSession(existingMainSession.previewSessionKey);
            }
          } else {
            this.applyPreviewTargetToTab(tab, previewTarget);
            if (tab.previewSessionKey) {
              previewPresentationReused = this.previewFrame.activateSession(tab.previewSessionKey);
            }
          }
        }
      }
    }
    // Resolve dependency ownership before activating language tools. Included
    // chapters, templates, and libraries inherit the main document's script
    // languages; unrelated files use only their own directive.
    this.activateSpellcheckDocument(isMarkdownDocument ? null : path);
    this.clearPendingLspSync();
    this.previewSyncController.clearForward();
    this.renderEditorTabs();
    if (!isMarkdownDocument) this.spellcheckController.schedule();
    if (path.toLowerCase().endsWith(".typ")) {
      this.scheduleDocumentOutlineUpdate(path, 0);
      this.documentOutlineController.setCursorPosition(this.editorInstance.state.selection.main.head, this.activeFilePath);
      this.restoreCachedEditorDiagnostics(path);
    } else {
      this.documentOutlineController.clear();
    }


    if (!options.skipPreviewActivation && isTypstDocument && this.lspReady && this.lspClient) {
      const lspRes = await this.getLspUriAndContent(path, tab.content);
      if (lspRes) {
        const { uri: lspUri, content: lspContent } = lspRes;
        await this.openDocumentIfNeeded(lspUri, lspContent, this.currentVersion);
      }
      if (!previewGuarded) {
        const lspMainPath = previewTarget
          ? previewLspMainPath(previewTarget)
          : (this.previewStandalone ? this.previewRootPath : (this.previewMainPath ?? this.previewRootPath));
        const pinChanged = await this.updatePinnedMain(lspMainPath);
        if (pinChanged) {
          await this.recheckActiveDocumentAfterPin(tab.content);
        }
      }

      if (previewGuarded) {
        // The source editor remains active while preview startup waits for consent.
      } else if (options.preservePreviewSession) {
        // preserve
      } else if (!this.pinnedMainFilePath) {
        this.previewFrame.setMessage(this.noMainFileMessage());
      } else if (previewTarget?.disabled) {
        this.previewFrame.setMessage(this.disabledPreviewMessage());
      } else if (this.previewRootPath) {
        if (!previewPresentationReused) void this.renderPdfPreview(tab.content);
      } else {
        this.previewFrame.setMessage(`<div style="padding: 20px; color: var(--ui-header-text); font-family: var(--font-family-sans);">No preview root found for this library/template file. Diagnostics are still active.</div>`);
      }
    } else if (!options.skipPreviewActivation && isTypstDocument) {
      if (!previewGuarded && !options.preservePreviewSession && this.previewRootPath && !this.previewDisabled) {
        void this.renderPdfPreview(tab.content);
      }
    }

    if (this.activeMode === "WYSIWYM") {
      this.mapMarkupToWysiwym(tab.content);
    }

    this.updateWorkspaceViewportVisibility();
    this.editorController.refreshLayout("tab activation");
    this.updateManualForwardSyncAction();
    if (options.focusEditor !== false) this.editorInstance.focus();
    this.saveWorkspaceState();
    this.resumeDeferredWorkspaceServices();
  }

  private resumeDeferredWorkspaceServices(): void {
    if (!this.workspaceServicesDeferredForLargeFile || !this.workspaceRootPath) return;
    const workspacePath = this.workspaceRootPath;
    this.workspaceServicesDeferredForLargeFile = false;
    void this.startWorkspaceServices(workspacePath);
  }

  private async initLsp(shouldConnect = true) {
    await this.documentSessionController.initialize(shouldConnect);
  }

  private createTinymistClient(): TinymistLspClient {
    const client = new TinymistLspClient(
      () => this.workspaceRootPath,
      () => {},
      status => this.setLspStatus(status),
      (uri, position) => this.handleInverseSync(uri, position),
      (uri, diagnostics, version) => this.handleLspDiagnostics(uri, diagnostics, version),
      entry => this.appendLspLog(entry),
      items => this.documentOutlineController.updatePreviewPositions(items),
      context => this.handlePreviewStartupFailure(context),
    );
    client.setEditorView(this.editorInstance);
    return client;
  }

  private handleTinymistConnected(): void {
    void this.discoverSurroundWithOptions();
    this.sourceMapSessionController.reset({ retry: false });
  }

  private async discoverSurroundWithOptions(): Promise<void> {
    const client = this.lspClient;
    const workspaceRoot = this.workspaceRootPath;
    const generation = ++this.surroundWithDiscoveryGeneration;
    this.surroundWithOptions = SURROUND_WITH_OPTIONS;
    if (!client || !workspaceRoot || !this.lspReady) return;

    const source = "#none";
    const virtualPath = await join(
      workspaceRoot,
      ".typsastra",
      "cache",
      "surround-with-discovery.typ",
    );
    const uri = filePathToUri(virtualPath);
    try {
      await client.openTextDocument(uri, source, generation);
      const response = await client.request<
        SurroundWithCompletionItem[] | { items?: SurroundWithCompletionItem[] } | null
      >("textDocument/completion", {
        textDocument: { uri },
        position: { line: 0, character: 1 },
        context: { triggerKind: 1 },
      }, 5000);
      if (generation !== this.surroundWithDiscoveryGeneration || client !== this.lspClient) return;
      const items = Array.isArray(response) ? response : response?.items ?? [];
      this.surroundWithOptions = mergeDiscoveredSurroundWithOptions(items);
      this.appendDeveloperLog({
        kind: "info",
        source: "lsp autocomplete",
        message: `Discovered ${this.surroundWithOptions.length - SURROUND_WITH_OPTIONS.length} additional bracket-capable Surround With function(s).`,
      });
    } catch (error) {
      if (generation !== this.surroundWithDiscoveryGeneration) return;
      this.appendDeveloperLog({
        kind: "warning",
        source: "lsp autocomplete",
        message: `Using built-in Surround With functions because Tinymist discovery failed: ${String(error)}`,
      });
    } finally {
      await client.closeTextDocument(uri).catch(() => {});
    }
  }

  private resetTinymistSessionState(): void {
    this.surroundWithDiscoveryGeneration += 1;
    this.surroundWithOptions = SURROUND_WITH_OPTIONS;
    this.lspReady = false;
    this.pinnedLspMainPath = null;
    this.openedDocumentUris.clear();
    this.clearPendingLspSync();
    this.previewSyncController.clearForward();
    this.clearDiagnostics();
    this.sourceMapSessionController.reset();
    this.previewSyncController.clearWarmup();
    this.pdfPreviewRenderController.resetSourceMapIdentity();
  }

  private stopTinymistSession(statusMessage: string): Promise<void> {
    return this.documentSessionController.stop(statusMessage);
  }

  private restartTinymistSession(statusMessage: string): Promise<void> {
    return this.documentSessionController.restart(statusMessage);
  }

  private recoverTinymistPreviewAfterUnexpectedStop(
    contents: string,
    failedGeneration: number
  ): Promise<boolean> {
    if (this.tinymistPreviewRecovery) return this.tinymistPreviewRecovery;
    if (
      this.tinymistPreviewRecoveryAttempts >= 1
      || !this.workspaceRootPath
      || !this.activeFilePath
      || !this.lspClient
    ) {
      return Promise.resolve(false);
    }

    const workspacePath = this.workspaceRootPath;
    const activePath = this.activeFilePath;
    this.tinymistPreviewRecoveryAttempts += 1;
    this.appendDeveloperLog({
      kind: "warning",
      source: "lsp lifecycle",
      message: `Render generation ${failedGeneration} was interrupted because Tinymist stopped; attempting one automatic recovery.`
    });
    this.setLspStatus({ kind: "starting", message: "Recovering preview compiler" });
    if (!this.previewFrame.currentUrl) {
      this.previewFrame.setLoading("Recovering PDF preview...");
    }

    const recovery = (async () => {
      try {
        await this.restartTinymistSession("Recovering interrupted preview...");
        if (
          this.workspaceRootPath !== workspacePath
          || filePathKey(this.activeFilePath ?? "") !== filePathKey(activePath)
        ) {
          return false;
        }
        await this.restoreActiveDocumentAfterTinymistRestart(false);
        if (!this.lspReady) return false;

        // A newer external edit may already be waiting behind the failed
        // generation. Preserve it; otherwise retry the accepted revision that
        // was interrupted. The render scheduler remains the sole serialization
        // point for compilation and presentation.
        this.pdfPreviewRenderController.queueRecovery(contents);
        this.appendDeveloperLog({
          kind: "info",
          source: "lsp lifecycle",
          message: `Tinymist recovered after render generation ${failedGeneration}; the latest preview revision was requeued.`
        });
        return true;
      } catch (recoveryError) {
        this.appendDeveloperLog({
          kind: "error",
          source: "lsp lifecycle",
          message: `Automatic Tinymist recovery failed after render generation ${failedGeneration}: ${String(recoveryError)}`
        });
        return false;
      }
    })();
    this.tinymistPreviewRecovery = recovery;
    void recovery.finally(() => {
      if (this.tinymistPreviewRecovery === recovery) {
        this.tinymistPreviewRecovery = null;
      }
    });
    return recovery;
  }

  private handlePreviewStartupFailure(context: {
    path: string;
    taskId: string;
    refreshStyle: "on-type" | "on-save";
    partialRendering: boolean;
    message: string;
  }): void {
    this.sourceMapSessionController.resetIfTaskFailed(context.taskId);
    this.appendDeveloperLog({
      kind: "error",
      source: "preview startup",
      message: [
        `Tinymist preview startup failed: ${context.message}`,
        `root=${context.path}`,
        `task=${context.taskId}`,
        `mode=${context.refreshStyle}`,
        `partialRendering=${context.partialRendering}`,
        `active=${this.activeFilePath ?? "n/a"}`,
        `previewRoot=${this.previewRootPath ?? "n/a"}`,
        `previewMain=${this.previewMainPath ?? "n/a"}`
      ].join("; ")
    });
  }

  private async handleToolchainChanged(status: ToolchainStatus) {
    this.toolchainController.setStatus(status);
    this.lspReady = false;
    this.sourceMapSessionController.reset({ retry: false });
    this.pinnedLspMainPath = null;
    this.openedDocumentUris.clear();
    this.previewFrame.clear();
    await this.initLsp(status.lspAvailable);
    const activePath = this.activeFilePath;
    if (activePath) {
      this.activeFilePath = null;
      await this.activateEditorTab(activePath, false);
    }
  }



  private async loadFile(path: string, options: LoadFileOptions = {}) {
    const existingTab = this.openTabs.find((tab) => filePathKey(tab.path) === filePathKey(path));
    if (existingTab) {
      if (!options.temporary) {
        void this.promoteToPermanent(existingTab);
      }
      await this.activateEditorTab(existingTab.path, true, {
        preservePreviewSession: options.preservePreviewSession,
        skipPreviewActivation: options.skipPreviewActivation,
        focusEditor: options.focusEditor
      });
      return;
    }
    if (this.activeFilePath && filePathKey(this.activeFilePath) === filePathKey(path)) {
      this.activeFilePath = null;
    }

    try {
      const internallySupported = await this.classifyUnknownTextPath(path);
      const deferredContent = internallySupported && !isBinaryImagePath(path);
      const contents = isBinaryImagePath(path)
        ? await invoke<string>("read_workspace_file_as_base64", { path })
        : "";
      const newTab: EditorTab = {
        path,
        content: contents,
        savedContent: contents,
        contentLoaded: !deferredContent,
        isDirty: false,
        previewRootPath: null,
        previewMainPath: null,
        previewTaskId: null,
        previewSessionKey: null,
        previewImported: false,
        previewStandalone: true,
        previewDisabled: false,
        version: 1,
        latestVersion: 1,
        selectionAnchor: 0,
        selectionHead: 0,
        foldRanges: [],
        foldStateExplicit: false,
        temporary: options.temporary
      };

      if (options.temporary) {
        const existingTempIndex = this.openTabs.findIndex(t => t.temporary && !t.isDirty);
        if (existingTempIndex >= 0) {
          this.openTabs.splice(existingTempIndex, 1);
        }
      }

      this.openTabs.push(newTab);
      this.renderEditorTabs();
      await this.activateEditorTab(path, true, {
        preservePreviewSession: options.preservePreviewSession,
        skipPreviewActivation: options.skipPreviewActivation,
        focusEditor: options.focusEditor
      });
    } catch (e) {
      console.error("Failed to load file:", e);
      alert("Failed to load file: " + e);
    }
  }

  private saveActiveFile(intent: SaveIntent = "manual"): Promise<void> {
    return this.documentPersistenceController.saveActiveFile(intent);
  }

  private configureAutoSave(enabled: boolean, intervalSeconds: number): void {
    this.documentPersistenceController.configureAutoSave(enabled, intervalSeconds);
  }

  private saveActiveFileAs(): Promise<void> {
    return this.documentPersistenceController.saveActiveFileAs();
  }

  private async formatActiveDocument(options: { silent?: boolean } = {}): Promise<boolean> {
    if (!this.activeFilePath || !isTypstDocumentPath(this.activeFilePath) || this.activeMode !== "CODE") return false;
    if (!this.lspReady || !this.lspClient) {
      if (!options.silent) this.setLspStatus({ kind: "error", message: "Formatter unavailable until Tinymist LSP is ready" });
      return false;
    }

    try {
      await this.flushPendingLspSync();
      const doc = this.editorInstance.state.doc;
      const edits = await this.lspClient.formatTextDocument(filePathToUri(this.activeFilePath), doc, {
        tabSize: this.settingsController.value.editor.tabSize,
        insertSpaces: true
      });
      this.applyFormattingEdits(edits);
      if (!options.silent) {
        this.setLspStatus({ kind: "preview-ready", message: edits.length > 0 ? "Document formatted" : "Document already formatted" });
      }
      return true;
    } catch (error) {
      try {
        await this.typographyController.reloadWorkspaceFonts();
      } catch (restartError) {
        this.appendDeveloperLog({
          kind: "error",
          source: "typography",
          message: `Failed to restore Tinymist after typography error: ${String(restartError)}`
        });
      }
      this.appendLspLog({
        kind: "warning",
        source: "formatter",
        message: `Format failed: ${String(error)}`
      });
      if (!options.silent) this.setLspStatus({ kind: "error", message: `Format failed: ${String(error)}` });
      return false;
    }
  }

  private removeTrailingSpaces(): void {
    if (this.activeMode !== "CODE" || !this.editorInstance) return;
    const doc = this.editorInstance.state.doc;
    const changes: { from: number; to: number; insert: string }[] = [];
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      const match = /[ \t]+$/u.exec(line.text);
      if (match) {
        changes.push({
          from: line.from + match.index,
          to: line.to,
          insert: ""
        });
      }
    }
    if (changes.length > 0) {
      this.editorInstance.dispatch({
        changes,
        userEvent: "input.format"
      });
    }
  }

  private applyFormattingEdits(edits: EditorTextEdit[]): void {
    if (edits.length === 0) return;
    const changes = edits
      .slice()
      .sort((a, b) => a.from - b.from)
      .map(edit => ({ from: edit.from, to: edit.to, insert: edit.insert }));
    this.editorInstance.dispatch({
      changes,
      userEvent: "input.format"
    });
  }

  private workspaceText(path: string): Promise<string> {
    const tab = this.openTabs.find(candidate => filePathKey(candidate.path) === filePathKey(path));
    return tab?.contentLoaded ? Promise.resolve(tab.content) : invoke<string>("read_workspace_file", { path });
  }

  private async writeWorkspaceText(path: string, content: string): Promise<void> {
    await invoke("save_workspace_file", { path, contents: content });
    const tab = this.openTabs.find(candidate => filePathKey(candidate.path) === filePathKey(path));
    if (tab) {
      tab.content = content;
      tab.savedContent = content;
      tab.contentLoaded = true;
      tab.isDirty = false;
      tab.version++;
      tab.latestVersion = tab.version;
      tab.undoHistory = undefined;
      if (this.activeFilePath && filePathKey(this.activeFilePath) === filePathKey(path)) {
        this.isLoadingFile = true;
        try {
          const selection = this.editorInstance.state.selection.main;
          const editorFontEffect = this.editorFontManager.prepareDocument(content);
          this.editorInstance.setState(createTabEditorState({
            doc: content,
            anchor: Math.min(selection.anchor, content.length),
            head: Math.min(selection.head, content.length),
            extensions: this.editorExtensions,
          }));
          this.editorInstance.dispatch({
            effects: [
              ...this.currentEditorSettingsEffects(),
              ...(editorFontEffect ? [editorFontEffect] : []),
              languageCompartment.reconfigure(this.editorLanguageForPath(path)),
              completionCompartment.reconfigure(this.editorCompletionForPath(path)),
            ]
          });
        } finally {
          this.isLoadingFile = false;
        }
      }
      this.renderEditorTabs();
    }
    if (this.lspReady && this.lspClient) {
      const lspRes = await this.getLspUriAndContent(path, content);
      if (lspRes) {
        const { uri: lspUri, content: lspContent } = lspRes;
        const version = tab?.version ?? this.currentVersion;
        await this.openDocumentIfNeeded(lspUri, lspContent, version);
        await this.lspClient.notifyTextChange(lspUri, lspContent, version);
        await this.lspClient.notifyTextSave(lspUri, lspContent);
      }
    }
  }

  private applyEdit(text: string, edit: { from: number; to: number; insert: string }): string {
    return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  }

  private async applyTypography(
    config: DocumentTypography,
    target: "document" | "template"
  ): Promise<boolean> {
    if (!this.activeFilePath) return false;
    const ownsWorkspaceTypography = this.isPinnedMainFile(this.activeFilePath);
    if (ownsWorkspaceTypography && !await this.typographyController.confirmScaleRange(config)) return false;
    if (ownsWorkspaceTypography && !await this.typographyController.confirmVariantLimit(config)) return false;
    const typographyDocumentPath = this.activeFilePath;
    const previousAcceptedScale = this.typographyController.acceptedFonts(typographyDocumentPath);
    this.typographyController.setAcceptedFonts(typographyDocumentPath, config.fonts);
    try {
      if (target === "document") {
        const editor = this.editorInstance;
        const edit = typographyEdit(editor.state.doc.toString(), config);
        editor.dispatch({
          changes: edit,
          selection: { anchor: edit.from },
          scrollIntoView: true,
          userEvent: "input"
        });
        await this.saveActiveFile();
        const fontsChanged = ownsWorkspaceTypography
          ? await this.typographyController.updateWorkspaceFonts(config)
          : false;
        if (ownsWorkspaceTypography) await this.refreshActivePreviewRoot(fontsChanged);
        editor.focus();
        return true;
      }

      const activeText = this.editorInstance.state.doc.toString();
      const hasExistingBlock = activeText.includes("// typsastra:typography:start");
      const detectedTemplateFunc = findTemplateFunctionName(activeText);

      if (hasExistingBlock || detectedTemplateFunc) {
        const funcName = detectedTemplateFunc || "typsastra-typography";
        const edit = templateTypographyEdit(activeText, funcName, config);
        if (edit) {
          const editor = this.editorInstance;
          editor.dispatch({
            changes: {
              from: edit.from,
              to: edit.to,
              insert: edit.insert
            },
            selection: { anchor: edit.from },
            scrollIntoView: true,
            userEvent: "input"
          });
          await this.saveActiveFile();
          await this.typographyController.reloadTemplateContext(config);
          editor.focus();
          this.setLspStatus({ kind: "preview-ready", message: "Typography applied to template" });
          return true;
        }
      }

      const mainPath = this.previewStandalone ? this.activeFilePath : (this.previewMainPath ?? this.activeFilePath);
      const mainText = await this.workspaceText(mainPath!);
      const application = findLocalTemplateApplication(mainText);
      let updatedLocalTemplate = false;

      if (application) {
        const candidate = await join(await dirname(mainPath), application.importPath);
        const relativeToWorkspace = this.workspaceRootPath
          ? relativeFilePath(this.workspaceRootPath, candidate)
          : "";
        const insideWorkspace = !this.workspaceRootPath
          || relativeToWorkspace !== null;
        if (insideWorkspace && await invoke<boolean>("workspace_path_exists", { path: candidate })) {
          const templateText = await this.workspaceText(candidate);
          const edit = templateTypographyEdit(templateText, application.functionName, config);
          if (edit) {
            await this.writeWorkspaceText(candidate, this.applyEdit(templateText, edit));
            updatedLocalTemplate = true;
          }
        }
      }

      if (!updatedLocalTemplate) {
        const mainDirectory = await dirname(mainPath);
        const templatePath = await join(mainDirectory, "typsastra-template.typ");
        const exists = await invoke<boolean>("workspace_path_exists", { path: templatePath });
        let templateText = exists ? await this.workspaceText(templatePath) : newTypographyTemplate(config);
        if (exists) {
          const edit = templateTypographyEdit(templateText, "typsastra-typography", config);
          templateText = edit ? this.applyEdit(templateText, edit) : newTypographyTemplate(config);
        }
        await this.writeWorkspaceText(templatePath, templateText);

        const applicationEdit = ensureTypographyTemplateApplication(mainText);
        if (applicationEdit.insert || applicationEdit.from !== applicationEdit.to) {
          await this.writeWorkspaceText(mainPath, this.applyEdit(mainText, applicationEdit));
        }
      }

      const latestMainText = await this.workspaceText(mainPath!);
      const metadataEdit = documentScriptsEdit(latestMainText, config.fonts);
      const mainWithDocumentScripts = this.applyEdit(latestMainText, metadataEdit);
      if (mainWithDocumentScripts !== latestMainText) {
        await this.writeWorkspaceText(mainPath!, mainWithDocumentScripts);
      }
      if (this.isPinnedMainFile(mainPath!)) {
        this.mainDocumentScripts = config.fonts.map(font => ({ ...font }));
        this.configureDocumentLanguageTools(this.editorInstance.state.doc.toString());
      }

      await this.typographyController.reloadTemplateContext(config);
      this.setLspStatus({ kind: "preview-ready", message: "Typography applied to template" });
      this.editorInstance.focus();
      return true;
    } catch (error) {
      this.typographyController.setAcceptedFonts(typographyDocumentPath, previousAcceptedScale);
      this.appendLspLog({
        kind: "error",
        source: "typography",
        message: `Failed to apply template typography: ${String(error)}`
      });
      await message(String(error), { title: "Unable to apply typography", kind: "error" });
      return false;
    }
  }

  private applyPreviewTargetToTab(tab: EditorTab, target: PreviewTarget): void {
    const style = previewRefreshStyle(this.effectivePreviewRenderMode);
    const document = target.rootPath
      ? researchDocumentIdentity(this.workspaceRootPath ?? target.rootPath, target.mainPath, tab.path)
      : null;
    const identity = target.rootPath ? previewSessionIdentity(target.rootPath, style, document ?? undefined) : null;
    tab.previewRootPath = target.rootPath;
    tab.previewMainPath = target.mainPath;
    tab.previewTaskId = identity?.taskId ?? null;
    tab.previewSessionKey = identity?.key ?? null;
    tab.previewImported = target.imported;
    tab.previewStandalone = target.standalone;
    tab.previewDisabled = target.disabled;
    this.previewRootPath = tab.previewRootPath;
    this.previewMainPath = tab.previewMainPath;
    this.previewTaskId = tab.previewTaskId;
    this.previewSessionKey = tab.previewSessionKey;
    this.previewImported = tab.previewImported;
    this.previewStandalone = tab.previewStandalone;
    this.previewDisabled = tab.previewDisabled;
  }

  private capturePreviewSession(): PreviewSessionState {
    return {
      previewRootPath: this.previewRootPath,
      previewMainPath: this.previewMainPath,
      previewTaskId: this.previewTaskId,
      previewSessionKey: this.previewSessionKey,
      previewImported: this.previewImported,
      previewStandalone: this.previewStandalone,
      previewDisabled: this.previewDisabled
    };
  }

  private captureCurrentMainSessionForImportedTarget(target: PreviewTarget): PreviewSessionState | null {
    if (target.standalone) return null;
    if (!target.imported || !target.mainPath || !this.previewRootPath || !this.previewSessionKey) {
      return null;
    }
    const mainKey = filePathKey(target.mainPath);
    const currentRootMatchesMain = filePathKey(this.previewRootPath) === mainKey;
    const currentMainMatchesMain = this.previewMainPath
      ? filePathKey(this.previewMainPath) === mainKey
      : false;
    if (!currentRootMatchesMain && !currentMainMatchesMain) return null;
    // Reuse the already-presented main PDF, but retain ownership from the
    // target being activated. Copying the main tab's `imported=false` flag to
    // an included chapter or template makes subsequent on-save scheduling
    // incorrectly treat that dependency as unrelated.
    return {
      ...this.capturePreviewSession(),
      previewMainPath: target.mainPath,
      previewImported: target.imported,
      previewStandalone: target.standalone,
      previewDisabled: target.disabled
    };
  }

  private applyPreviewSessionToTab(tab: EditorTab, session: PreviewSessionState): void {
    tab.previewRootPath = session.previewRootPath;
    tab.previewMainPath = session.previewMainPath;
    tab.previewTaskId = session.previewTaskId;
    tab.previewSessionKey = session.previewSessionKey;
    tab.previewImported = session.previewImported;
    tab.previewStandalone = session.previewStandalone;
    tab.previewDisabled = session.previewDisabled;
    this.previewRootPath = session.previewRootPath;
    this.previewMainPath = session.previewMainPath;
    this.previewTaskId = session.previewTaskId;
    this.previewSessionKey = session.previewSessionKey;
    this.previewImported = session.previewImported;
    this.previewStandalone = session.previewStandalone;
    this.previewDisabled = session.previewDisabled;
  }

  private async rootRelativeTypstPath(path: string): Promise<string | null> {
    if (!this.workspaceRootPath) return null;
    const value = relativeFilePath(this.workspaceRootPath, path);
    if (value === null) return null;
    return `/${value.replace(/\\/g, "/")}`;
  }

  private async prepareTemplateAwarePreview(
    target: PreviewTarget,
    activePath: string,
    activeContents: string
  ): Promise<PreviewTarget> {
    if (
      !this.workspaceRootPath
      || !target.imported
      || !target.standalone
      || !target.mainPath
      || !target.rootPath
      || filePathKey(target.rootPath) !== filePathKey(activePath)
    ) return target;

    try {
      const mainText = await this.workspaceText(target.mainPath);
      const application = findLocalTemplateApplication(mainText);
      if (!application) return target;
      const templatePath = await join(await dirname(target.mainPath), application.importPath);
      if (!await invoke<boolean>("workspace_path_exists", { path: templatePath })) return target;
      const templateRootPath = await this.rootRelativeTypstPath(templatePath);
      const chapterRootPath = await this.rootRelativeTypstPath(activePath);
      if (!templateRootPath || !chapterRootPath) return target;

      const identity = previewSessionIdentity(
        activePath,
        previewRefreshStyle(this.effectivePreviewRenderMode),
        researchDocumentIdentity(this.workspaceRootPath, target.mainPath, activePath)
      );
      const previewPath = await join(
        this.workspaceRootPath,
        `.${fileNameFromPath(activePath)}.${identity.taskId}.typsastra-preview.typ`
      );
      const previewSource = templatePreviewSource(application, templateRootPath, chapterRootPath, activeContents);
      const existingSource = await invoke<string>("read_workspace_file", { path: previewPath }).catch(() => null);
      if (existingSource !== previewSource) {
        await invoke("save_workspace_file", { path: previewPath, contents: previewSource });
      }
      return { ...target, rootPath: previewPath };
    } catch (error) {
      this.appendLspLog({
        kind: "warning",
        source: "preview",
        message: `Using direct standalone preview because the main template could not be reused: ${String(error)}`
      });
      return target;
    }
  }

  private async openDocumentIfNeeded(uri: string, text: string, version: number): Promise<void> {
    if (this.openedDocumentUris.has(uri)) return;
    await this.lspClient.openTextDocument(uri, text, version);
    this.openedDocumentUris.add(uri);
  }

  private async closeDocumentIfOpened(path: string): Promise<void> {
    if (!this.lspClient) return;
    const uri = filePathToUri(path);
    if (!this.openedDocumentUris.delete(uri)) return;
    try {
      await this.lspClient.closeTextDocument(uri);
    } catch (error) {
      this.openedDocumentUris.add(uri);
      this.appendDeveloperLog({
        kind: "warning",
        source: "lsp",
        message: `Failed to close ${fileNameFromPath(path)} in Tinymist: ${String(error)}`
      });
    }
  }

  private async updatePinnedMain(path: string | null, force = false): Promise<boolean> {
    if (!this.lspReady || !this.lspClient) return false;
    const targetPath = path;
    if (!force && filePathKey(this.pinnedLspMainPath ?? "") === filePathKey(targetPath ?? "")) return false;
    try {
      await this.lspClient.pinMain(targetPath);
      this.pinnedLspMainPath = targetPath;
      return true;
    } catch (error) {
      this.appendLspLog({
        kind: "warning",
        source: "lsp",
        message: `Unable to set Tinymist main-file context: ${String(error)}`
      });
      return false;
    }
  }

  private async recheckActiveDocumentAfterPin(text: string): Promise<void> {
    if (!this.activeFilePath || !this.lspReady || !this.lspClient) return;
  
    this.clearDiagnostics();
  
    const activePath = this.activeFilePath;
    const lspRes = await this.getLspUriAndContent(activePath, text);
  
    if (!lspRes) return;
  
    const { uri: lspUri, content: lspContent } = lspRes;
  
    const activeTab = this.getActiveTab();
  
    //
    // After a Tinymist restart openedDocumentUris is cleared, so the
    // document must be registered with didOpen again.
    //
    if (!this.openedDocumentUris.has(lspUri)) {
      const openVersion = ++this.currentVersion;
  
      this.latestDocumentVersion = openVersion;
  
      if (activeTab && activeTab.path === activePath) {
        activeTab.version = openVersion;
        activeTab.latestVersion = openVersion;
      }
  
      await this.lspClient.openTextDocument(
        lspUri,
        lspContent,
        openVersion
      );
  
      this.openedDocumentUris.add(lspUri);
  
      this.appendDeveloperLog({
        kind: "info",
        source: "lsp lifecycle",
        message:
          `Reopened Tinymist document after restart: `
          + `${lspUri}; version=${openVersion}`
      });
  
      // didOpen already contains the complete current document.
      // Do not immediately send an identical didChange.
      return;
    }
  
    //
    // Document was already open, so this really is a change.
    //
    const changeVersion = ++this.currentVersion;
  
    this.latestDocumentVersion = changeVersion;
  
    if (activeTab && activeTab.path === activePath) {
      activeTab.version = changeVersion;
      activeTab.latestVersion = changeVersion;
    }
  
    await this.lspClient.notifyTextChange(
      lspUri,
      lspContent,
      changeVersion
    );
  
    this.appendDeveloperLog({
      kind: "info",
      source: "lsp lifecycle",
      message:
        `Resynchronized open Tinymist document: `
        + `${lspUri}; version=${changeVersion}`
    });
  }

  private renderPdfPreview(contents: string, force = false): Promise<void> {
    return this.pdfPreviewRenderController.render(contents, force);
  }

  private recompilePreviewManually(): void {
    this.pdfPreviewRenderController.recompileManually();
  }

  private loadPdfPath(
    path: string,
    identity: string,
    sessionKey = identity,
    surface: PreviewSurface = isTypstDocumentPath(identity) ? "live" : "pdf",
    deleteOnClose = false
  ): Promise<number> {
    return this.pdfPreviewRenderController.loadPdfPath(
      path,
      identity,
      sessionKey,
      surface,
      deleteOnClose,
    );
  }

  private schedulePdfPreview(
    contents: string,
    delayMs = this.settingsController.value.preview.syncDebounceMs
  ): void {
    this.pdfPreviewRenderController.schedule(contents, delayMs);
  }

  private handleContentMutation(rawText: string, previewDebounceElapsedMs = 0) {
    const canRenderPreview = activeFileCanRenderPreview(
      this.activeFilePath,
      this.pinnedMainFilePath,
      this.previewImported,
      this.previewDisabled
    );
    if (!this.isLoadingFile && canRenderPreview) {
      this.pdfPreviewRenderController.noteContentMutation(true);
    }
    this.appendDeveloperLog({
      kind: "info",
      source: "preview scheduler",
      message: `Document mutation: active=${this.activeFilePath ?? "none"}; sourceUtf16=${rawText.length}; loading=${this.isLoadingFile}; preparationRevision=${this.pdfPreparationRevision}; mode=${this.effectivePreviewRenderMode}; disabled=${this.previewDisabled}; lspReady=${this.lspReady}.`
    });
    if (this.activeFilePath && this.activeFilePath.toLowerCase().endsWith(".typ")) {
      this.scheduleDocumentOutlineUpdate(this.activeFilePath);
    }
    if (!this.isLoadingFile) {
      this.updateActiveTabContent(rawText);
      this.typographyController.scheduleManualScaleCheck();
      if (this.activeFilePath && isMarkdownDocumentPath(this.activeFilePath)) {
        this.markdownPreviewFrame.schedule(this.activeFilePath, rawText);
      }
    }

    if (!this.isLoadingFile && this.activeFilePath && isTypstDocumentPath(this.activeFilePath) && this.lspReady && this.lspClient) {
      const version = ++this.currentVersion;
      this.latestDocumentVersion = version;
      const activeTab = this.getActiveTab();
      if (activeTab && activeTab.path === this.activeFilePath) {
        activeTab.version = version;
        activeTab.latestVersion = version;
      }
      if (
        this.previewImported
        && allowsStandalonePreview(rawText) !== this.previewStandalone
        && this.effectivePreviewRenderMode === "on-type"
      ) {
        void this.refreshActivePreviewRoot();
      }
      this.documentSessionController.queueDocumentSync(
        this.activeFilePath,
        rawText,
        version,
        this.lspSyncDebounceMs,
        () => void this.flushPendingLspSync(),
      );
    }
    if (
      !this.isLoadingFile
      && this.activeFilePath
      && this.activeFilePath.toLowerCase().endsWith(".typ")
      && canRenderPreview
      && this.effectivePreviewRenderMode === "on-type"
      && !this.previewDisabled
    ) {
      const remainingPreviewDebounceMs = Math.max(
        0,
        this.settingsController.value.preview.syncDebounceMs - previewDebounceElapsedMs
      );
      if (remainingPreviewDebounceMs === 0) {
        void this.renderPdfPreview(rawText);
      } else {
        this.schedulePdfPreview(rawText, remainingPreviewDebounceMs);
      }
    }
  }

  private invalidatePreviewWork(reason: string): void {
    this.pdfPreviewRenderController.invalidate(reason);
  }

  private async flushPendingLspSync(): Promise<void> {
    // Completion, navigation, save, and other explicit LSP requests must see
    // the latest editor snapshot even when routine on-save synchronization is
    // waiting for an input pause.
    this.flushEditorContentMutation();
    if (!this.lspReady || !this.lspClient) return;
    const pending = this.documentSessionController.takePendingSync(filePathKey);
    if (!pending) return;
    const {
      path,
      text,
      version: pendingVersion,
      requestKey,
      generation: expectedGeneration,
    } = pending;

    this.previewSyncController.reset();
    if (this.workspaceRootPath && this.previewStandalone && this.effectivePreviewRenderMode === "on-type") {
      let target = await invoke<PreviewTarget>("resolve_preview_main", {
        filePath: path,
        workspaceRootPath: this.workspaceRootPath,
        fileContents: text,
        pinnedMainPath: this.pinnedMainFilePath
      });
      target = await this.prepareTemplateAwarePreview(target, path, text);
    }
    
    if (!this.documentSessionController.isSyncRequestCurrent(requestKey, expectedGeneration)) {
      return;
    }

    const version = pendingVersion ?? ++this.currentVersion;
    this.latestDocumentVersion = version;
    const activeTab = this.getActiveTab();
    if (activeTab && activeTab.path === path) {
      activeTab.version = version;
      activeTab.latestVersion = version;
    }
    const lspRes = await this.getLspUriAndContent(path, text);
    if (!lspRes) return;
    if (!this.isLspSyncVersionCurrent(path, version)) return;
    const { uri: lspUri, content: lspContent } = lspRes;
    await this.openDocumentIfNeeded(lspUri, lspContent, version);
    if (!this.isLspSyncVersionCurrent(path, version)) return;
    await this.lspClient.notifyTextChange(lspUri, lspContent, version);
  }

  private async restoreActiveDocumentAfterTinymistRestart(
    forcePreview = true
  ): Promise<void> {
    if (
      !this.activeFilePath ||
      !this.workspaceRootPath ||
      !this.lspReady ||
      !this.lspClient
    ) {
      return;
    }
  
    const activePath = this.activeFilePath;
    const tab = this.getActiveTab();
  
    if (!tab?.contentLoaded || !isTypstDocumentPath(tab.path)) {
      return;
    }
  
    const contents = this.editorInstance.state.doc.toString();
  
    try {
      //
      // IMPORTANT:
      // A Tinymist restart clears pinnedLspMainPath. Restore the project's
      // main-file context explicitly before reopening the active document.
      //
      let target = await invoke<PreviewTarget>("resolve_preview_main", {
        filePath: activePath,
        workspaceRootPath: this.workspaceRootPath,
        fileContents: contents,
        pinnedMainPath: this.pinnedMainFilePath
      });
  
      target = await this.prepareTemplateAwarePreview(
        target,
        activePath,
        contents
      );
  
      if (!target.disabled) {
        const mainPath = previewLspMainPath(target);
  
        await this.updatePinnedMain(
          mainPath,
          true
        );
  
        this.appendDeveloperLog({
          kind: "info",
          source: "lsp lifecycle",
          message:
            `Restored Tinymist main-file context after restart: `
            + `${mainPath ?? "none"}`
        });
      }
  
      //
      // Re-register the active editor document only after Tinymist knows
      // which main document owns the project context.
      //
      await this.recheckActiveDocumentAfterPin(contents);
  
      //
      // Preview restoration is intentionally last. Completion should not
      // depend on PDF-preview initialization finishing first.
      //
      await this.refreshActivePreviewRoot(forcePreview);
  
      this.appendDeveloperLog({
        kind: "info",
        source: "lsp lifecycle",
        message:
          `Restored Tinymist document context after restart: ${activePath}`
      });
    } catch (error) {
      this.appendDeveloperLog({
        kind: "error",
        source: "lsp lifecycle",
        message:
          `Failed to restore Tinymist document context after restart: `
          + String(error)
      });
  
      throw error;
    }
  }





  private clearPendingLspSync() {
    this.documentSessionController.clearPendingSync();
  }

  private isLspSyncVersionCurrent(path: string, version: number): boolean {
    const activeTab = this.getActiveTab();
    if (activeTab && filePathKey(activeTab.path) === filePathKey(path) && activeTab.latestVersion > version) {
      return false;
    }
    if (this.documentSessionController.hasNewerPendingSync(path, version, filePathKey)) return false;
    return true;
  }


  private handleInverseSync(
    uri: string | undefined,
    position: LspSourcePosition
  ): Promise<LspInverseSyncResult> {
    return this.previewSourceNavigationController.handleInverseSync(uri, position);
  }

  private revealCursorInPreviewManually(): void {
    this.previewSourceNavigationController.revealCursorInPreviewManually();
  }

  private cancelManualForwardSync(): void {
    this.previewSourceNavigationController.cancelManualForwardSync();
  }

  private updateManualForwardSyncAction(): void {
    this.previewSourceNavigationController.updateManualForwardSyncAction();
  }

  private renderManualForwardSyncAction(busy: boolean, available: boolean): void {
    this.previewSourceNavigationController.renderManualForwardSyncAction(busy, available);
  }

  private forwardSyncTarget(
    path: string,
    cursor: number
  ): Promise<{ filepath: string; line: number; character: number } | null> {
    return this.previewSourceNavigationController.forwardSyncTarget(path, cursor);
  }

  private handlePdfPreviewClick(point: PreviewClickPoint): Promise<void> {
    return this.previewSourceNavigationController.handlePdfPreviewClick(point);
  }

  private updatePreviewZoomLabel(zoomPercent?: number): void {
    this.previewUiController.updateZoomLabel(zoomPercent);
  }

  private schedulePdfSourceMapWarmup(generation: number): void {
    this.previewSyncController.scheduleWarmup(generation);
  }

  private initializePreviewPageControls(): void {
    this.previewUiController.initializePageControls();
  }

  private updatePreviewPageStatus(status: PreviewPageStatus): void {
    this.previewUiController.updatePageStatus(status);
  }

  private updatePreviewActionsToolbar(path: string | null): void {
    this.previewUiController.updateActionsToolbar(path);
  }

  private zoomIn(): void {
    this.previewUiController.zoomIn();
  }

  private zoomOut(): void {
    this.previewUiController.zoomOut();
  }

  private zoomToFit(): void {
    this.previewUiController.zoomToFit();
  }

  private async finishStartupInitialization(): Promise<void> {
    const startedAt = performance.now();
    try {
      const providers = await this.performanceController.timeStartup("finish native startup initialization", () =>
        invoke<unknown>("finish_startup_initialization")
      );
      this.handleLanguageProvidersChanged(providers);
      this.performanceController.recordFirst({
        name: "startup.deferred-initialization",
        milliseconds: performance.now() - startedAt,
        detail: { providerCount: this.spellcheckController.getAllProviders().length }
      });
    } catch (error) {
      console.warn("Deferred startup initialization failed:", error);
    } finally {
      void this.performanceController.logNativeStartupTimings();
      void this.settingsController.refreshSystemFonts();
    }
  }

  private reportPreviewInteractionStatus(status: PreviewInteractionStatus): void {
    this.previewUiController.reportInteractionStatus(status);
  }

  private utf8ByteLength(text: string): number {
    return new TextEncoder().encode(text).length;
  }

  private setLspStatus(status: LspStatus) {
    this.lspStatus.dataset.state = status.kind;
    this.lspStatusDot.setAttribute("aria-label", status.message);
    this.lspStatusText.textContent = status.message;

    if (status.kind === "stopped" || status.kind === "error") {
      this.lspReady = false;
    }
    this.updateManualForwardSyncAction();
  }

  private handleLspDiagnostics(uri: string, diagnostics: LspDiagnostic[], version?: number): Promise<void> {
    return this.diagnosticsController.handleLspDiagnostics(uri, diagnostics, version);
  }

  private recoverPreviewAfterAcceptedDiagnostics(diagnostics: readonly LspDiagnostic[]): void {
    if (
      this.effectivePreviewRenderMode !== "on-type"
      || this.lastFailedPreviewContents === null
      || diagnostics.some(diagnostic => diagnostic.severity === 1)
    ) return;

    const latestContents = this.editorInstance.state.doc.toString();
    if (
      latestContents === this.lastFailedPreviewContents
      || latestContents === this.lastPreviewRecoveryRequestedContents
      || !activeFileCanRenderPreview(
        this.activeFilePath,
        this.pinnedMainFilePath,
        this.previewImported,
        this.previewDisabled,
      )
    ) return;

    this.lastPreviewRecoveryRequestedContents = latestContents;
    this.appendDeveloperLog({
      kind: "info",
      source: "preview scheduler",
      message: `LSP accepted a corrected revision after preview failure; requeueing ${latestContents.length} UTF-16 code unit(s).`,
    });
    void this.renderPdfPreview(latestContents);
  }
  private appendLspLog(entry: LspLogEntry) {
    this.logConsoleController.appendLog({
      kind: entry.kind,
      source: entry.source ?? "tinymist",
      message: entry.message,
      channel: "lsp"
    });
  }

  private appendDeveloperLog(entry: LspLogEntry) {
    const source = entry.source ?? "developer";
    if (!this.isDeveloperLogEnabled(this.developerLogCategory(source))) return;
    this.logConsoleController.appendLog({
      kind: entry.kind,
      source,
      message: entry.message,
      channel: "dev"
    });
  }

  private appendSpellcheckDebug(event: SpellcheckDebugEvent): void {
    if (!this.isDeveloperLogEnabled("spellcheck")) return;
    const message = `${event.stage} [revision ${event.revision}]: ${JSON.stringify(event.detail)}`;
    console.info(`[spellcheck debug] ${event.documentKey || "no-document"} ${message}`);
    const filePath = this.activeFilePath ?? undefined;
    this.logConsoleController.appendLog({
      kind: event.stage.endsWith("failed") ? "warning" : "info",
      source: "spellcheck debug",
      message,
      channel: "dev",
      filePath,
      fileName: filePath ? fileNameFromPath(filePath) : undefined,
    });
  }

  private developerLogCategory(source: string): DeveloperLogCategory {
    const normalized = source.toLocaleLowerCase();
    if (normalized.includes("inverse sync")) return "inverseSync";
    if (normalized.includes("forward sync")) return "forwardSync";
    if (normalized.includes("memory")) return "memory";
    if (normalized.includes("performance")) return "performance";
    if (normalized.includes("preview")) return "preview";
    if (normalized.includes("lsp") || normalized.includes("tinymist") || normalized.includes("toolchain")) return "lsp";
    if (normalized.includes("spellcheck") || normalized.includes("language scope") || normalized.includes("document script")) return "spellcheck";
    return "general";
  }

  private isDeveloperLogEnabled(category: DeveloperLogCategory): boolean {
    const settings = this.settingsController.value;
    return settings.developerMode && settings.developerLogs[category];
  }

  private updateSpellcheckLog(issues: readonly SpellingIssue[]): void {
    this.diagnosticsController.updateSpellcheckLog(issues);
  }
  private syncSelectedSpellingLocation(): void {
    this.diagnosticsController.syncSelectedSpellingLocation();
  }
  private clearDiagnostics(): void {
    this.diagnosticsController.clear();
  }

  private clearEditorDiagnostics(): void {
    this.diagnosticsController.clearEditorDiagnostics();
  }

  private restoreCachedEditorDiagnostics(path: string): void {
    this.diagnosticsController.restoreCachedEditorDiagnostics(path);
  }

  private editorPositionFromLspPosition(position: LspSourcePosition): number | null {
    return this.diagnosticsController.editorPositionFromLspPosition(position);
  }
  private navigateToLogEntry(entry: LogConsoleEntryInput): Promise<void> {
    return this.diagnosticsController.navigateToLogEntry(entry);
  }
  private async navigateToLspLocation(uri: string, line: number, character: number) {
    const rawPath = filePathFromUri(uri);
    let filePath = this.mapToOriginalPath(rawPath);
    if (filePath !== this.activeFilePath) {
      await this.loadFile(filePath);
    }
    if (!this.getActiveTab()?.contentLoaded) return;
    
    let cursor = 0;
    if (this.isRenderCachePath(rawPath) && this.lspClient) {
      const relPath = filePath.startsWith(this.workspaceRootPath!)
        ? filePath.substring(this.workspaceRootPath!.length).replace(/^[/\\]+/, "")
        : filePath;
      const cacheContent = await this.pdfGeneratedPreviewText(filePath);
      cursor = await this.mapCacheLspPositionToOriginalEditorOffset(relPath, { line, character }, cacheContent) ?? 0;
    } else if (this.lspClient) {
      cursor = this.lspClient.editorPositionFromLspPosition({ line, character });
    } else {
      const doc = this.editorInstance.state.doc;
      const lineInfo = doc.line(Math.max(1, Math.min(line + 1, doc.lines)));
      cursor = Math.max(lineInfo.from, Math.min(lineInfo.from + character, lineInfo.to));
    }
    
    this.editorInstance.dispatch({
      selection: { anchor: cursor },
      effects: EditorView.scrollIntoView(cursor, { y: "center" })
    });
    this.editorInstance.focus();
  }

  private async navigateToOutlineHeading(heading: DocumentHeading) {
    const activeTab = this.getActiveTab();
    if (activeTab?.temporary) {
      void this.promoteToPermanent(activeTab);
    }

    if (heading.filePath !== this.activeFilePath) {
      await this.loadFile(heading.filePath, { focusEditor: false });
    }
    if (!this.getActiveTab()?.contentLoaded) return;
    if (this.activeMode === "WYSIWYM") this.switchViewLayoutMode();
    const currentHeading = this.documentOutlineController.findHeading(heading.id) ?? heading;
    const cursor = Math.max(0, Math.min(currentHeading.textFrom, this.editorInstance.state.doc.length));
    this.previewSyncController.clearForward();
    this.editorInstance.dispatch({
      selection: { anchor: cursor },
      effects: EditorView.scrollIntoView(cursor, { y: "start", yMargin: 28 })
    });
    this.documentOutlineController.setCursorPosition(cursor, this.activeFilePath);
    if (currentHeading.previewPosition) {
      this.previewFrame.scrollToPage(currentHeading.previewPosition.page_no);
    } else {
      const previewPos = this.documentOutlineController.previewPositionAt(cursor);
      if (previewPos) {
        this.previewFrame.scrollToPage(previewPos.page_no);
      }
    }
  }

  private switchViewLayoutMode() {
    if (!this.wysiwymPane) return;
    if (this.activeMode === "CODE") {
      this.activeMode = "WYSIWYM";
      this.mapMarkupToWysiwym(this.editorInstance.state.doc.toString());
      this.codePane.classList.add("hidden");
      this.wysiwymPane.classList.remove("hidden");
      this.editorVisualToolbar.classList.add("wysiwym-active");
    } else {
      this.activeMode = "CODE";
      const markup = this.mapWysiwymToMarkup();
      this.editorInstance.dispatch({
        changes: { from: 0, to: this.editorInstance.state.doc.length, insert: markup }
      });
      this.wysiwymPane.classList.add("hidden");
      this.codePane.classList.remove("hidden");
      this.editorVisualToolbar.classList.remove("wysiwym-active");
    }
  }

  private saveWorkspaceState(): Promise<void> {
    return this.workspaceController.saveState();
  }


  private handleWorkspaceChange(change: WorkspaceChange): Promise<void> {
    return this.externalWorkspaceController.handleChange(change);
  }
  private async retirePdfSourceMapSession(reason: string): Promise<void> {
    this.cancelManualForwardSync();
    this.previewSyncController.reset();
    const taskId = this.sourceMapSessionController.registeredTaskId;
    await this.sourceMapSessionController.retire(this.lspClient).catch(error => {
      this.appendDeveloperLog({
        kind: "warning",
        source: "workspace",
        message: `Could not stop stale source-map task ${taskId ?? "unknown"}: ${String(error)}`
      });
    });
    this.appendDeveloperLog({
      kind: "info",
      source: "workspace",
      message: `Retired PDF source-map session after ${reason}.`
    });
  }

  private async waitForExternalPreviewRefresh(timeoutMs = 60000): Promise<void> {
    const startedAt = performance.now();
    let stableFrames = 0;
    let observedGeneration = this.pdfPreviewGeneration;
    while (performance.now() - startedAt < timeoutMs) {
      await new Promise<void>(resolve => window.setTimeout(resolve, 16));
      const generationChanged = observedGeneration !== this.pdfPreviewGeneration;
      observedGeneration = this.pdfPreviewGeneration;
      if (
        generationChanged
        || this.pdfPreviewRunning
        || this.pdfPreviewRenderController.queued
      ) {
        stableFrames = 0;
        continue;
      }
      stableFrames += 1;
      if (stableFrames >= 3) return;
    }
    this.appendDeveloperLog({
      kind: "warning",
      source: "workspace",
      message: "External preview refresh did not settle within 60000ms; cursor synchronization remains available for the last presented PDF."
    });
  }

  private async reloadOpenFilesFromDisk(refreshPreview = true): Promise<boolean> {
    let changed = false;
    for (const tab of [...this.openTabs]) {
      const pathKey = filePathKey(tab.path);
      const exists = await invoke<boolean>("workspace_path_exists", { path: tab.path });
      if (!exists) {
        if (tab.isDirty) {
          this.reportExternalConflict(tab.path, "was removed outside Typsastra");
        } else {
          this.externalConflictPaths.delete(pathKey);
          await this.closeEditorTab(tab.path, true);
        }
        changed = true;
        continue;
      }

      // Unsupported files are represented by a lightweight editor placeholder
      // and are never decoded or synchronized as text.
      if (!this.isInternallySupportedPath(tab.path)) continue;
      // Restored inactive tabs are descriptors only. Reading them here would
      // defeat lazy restoration and can eagerly decode very large PDFs.
      if (!tab.contentLoaded) {
        tab.sizeBytes = undefined;
        tab.lineCount = undefined;
        continue;
      }
      if (fileExtension(tab.path) === "pdf") {
        if (this.activeFilePath && filePathKey(tab.path) === filePathKey(this.activeFilePath)) {
          void this.loadPdfPath(tab.path, tab.path);
        }
        continue;
      }

      let contents: string;
      try {
        contents = isBinaryImagePath(tab.path)
          ? await invoke<string>("read_workspace_file_as_base64", { path: tab.path })
          : normalizeEditorText(await invoke<string>("read_workspace_file", { path: tab.path }));
      } catch (error) {
        console.warn(`Unable to reload ${tab.path}:`, error);
        continue;
      }

      if (contents === tab.savedContent) {
        this.externalConflictPaths.delete(pathKey);
        continue;
      }
      if (contents === tab.content) {
        tab.savedContent = contents;
        tab.isDirty = false;
        this.externalConflictPaths.delete(pathKey);
        this.renderEditorTabs();
        changed = true;
        continue;
      }
      if (tab.isDirty) {
        this.reportExternalConflict(tab.path, "changed outside Typsastra");
        changed = true;
        continue;
      }

      this.externalConflictPaths.delete(pathKey);
      await this.applyExternalFileContent(tab, contents, refreshPreview);
      changed = true;
    }
    return changed;
  }

  private async applyExternalFileContent(tab: EditorTab, contents: string, refreshPreview = true): Promise<void> {
    const isActive = this.activeFilePath !== null && filePathKey(tab.path) === filePathKey(this.activeFilePath);
    tab.content = contents;
    tab.savedContent = contents;
    tab.contentLoaded = true;
    tab.isDirty = false;
    tab.undoHistory = undefined;

    if (!isActive) {
      this.renderEditorTabs();
      return;
    }

    if (isBinaryImagePath(tab.path)) {
      const img = document.getElementById("image-viewer-img") as HTMLImageElement;
      if (img) img.src = contents;
      this.renderEditorTabs();
      return;
    }

    if (fileExtension(tab.path) === "pdf") {
      if (refreshPreview) {
        void this.loadPdfPath(tab.path, tab.path);
      }
      this.renderEditorTabs();
      return;
    }

    const selection = this.editorInstance.state.selection.main;
    this.isLoadingFile = true;
    try {
      // Keep external reloads atomic from the user's perspective as well: the
      // matching Unicode font policy must precede the replacement text.
      const editorFontEffect = this.editorFontManager.prepareDocument(contents);
      this.editorInstance.setState(createTabEditorState({
        doc: contents,
        anchor: Math.min(selection.anchor, contents.length),
        head: Math.min(selection.head, contents.length),
        extensions: this.editorExtensions,
      }));
      this.editorInstance.dispatch({
        effects: [
          ...this.currentEditorSettingsEffects(),
          ...(editorFontEffect ? [editorFontEffect] : []),
          languageCompartment.reconfigure(this.editorLanguageForPath(tab.path)),
          completionCompartment.reconfigure(this.editorCompletionForPath(tab.path)),
        ]
      });
    } finally {
      this.isLoadingFile = false;
    }

    this.renderEditorTabs();
    if (tab.path.toLowerCase().endsWith(".typ")) {
      void this.documentOutlineController.update(
        tab.path, 
        contents, 
        this.workspaceRootPath || "", 
        async (p) => {
          try {
            return await invoke<string>("read_workspace_file", { path: p });
          } catch {
            return null;
          }
        }
      );
      this.documentOutlineController.setCursorPosition(this.editorInstance.state.selection.main.head, this.activeFilePath);
    } else {
      this.documentOutlineController.clear();
    }
    if (this.activeMode === "WYSIWYM") this.mapMarkupToWysiwym(contents);

    const version = ++this.currentVersion;
    this.latestDocumentVersion = version;
    tab.version = version;
    tab.latestVersion = version;
    let lspUpdated = false;
    if (this.lspReady && this.lspClient) {
      const lspRes = await this.getLspUriAndContent(tab.path, contents);
      if (lspRes) {
        const { uri: lspUri, content: lspContent } = lspRes;
        await this.openDocumentIfNeeded(lspUri, lspContent, version);
        await this.lspClient.notifyTextChange(lspUri, lspContent, version);
        await this.lspClient.notifyTextSave(lspUri, lspContent);
        lspUpdated = true;
      }
    }
    if (
      refreshPreview
      && participatesInPreviewCompilation(tab.path, this.pinnedMainFilePath, tab.previewImported)
      && tab.path.toLowerCase().endsWith(".typ")
      && !tab.previewDisabled
    ) {
      if (this.effectivePreviewRenderMode === "on-save") {
        void this.renderPdfPreview(contents);
      } else {
        this.schedulePdfPreview(contents);
      }
    }
    this.setLspStatus({
      kind: lspUpdated || !isTypstDocumentPath(tab.path) ? "preview-ready" : "sync-pending",
      message: lspUpdated
        ? "Reloaded external file change"
        : isTypstDocumentPath(tab.path)
          ? "Reloaded external file; preview update queued"
          : "Reloaded external file"
    });
  }

  private noMainFileMessage(): string {
    return this.previewContentController.noMainFileMessage();
  }

  private disabledPreviewMessage(): string {
    return this.previewContentController.disabledPreviewMessage();
  }

  private renderNonTextEditorPlaceholder(path: string, unsupported: boolean): void {
    this.editorFileGuardController.renderNonTextPlaceholder(path, unsupported);
  }

  private showLargeFileConfirmation(tab: EditorTab, notice: LargeFileOpeningNotice): void {
    this.editorFileGuardController.showLargeFileConfirmation(tab, notice);
  }

  private clearGuardrailAlignment(): void {
    this.editorFileGuardController.clearAlignment();
  }

  private openFileExternally(path: string, button?: HTMLButtonElement): Promise<void> {
    return this.editorFileGuardController.openFileExternally(path, button);
  }

  private renderImageToolPreview(source: string | null, imagePath?: string): void {
    this.previewContentController.renderImageToolPreview(source, imagePath);
  }

  private renderInteractiveImageViewer(
    src: string,
    previewPath = this.activeFilePath ?? "preview.png",
  ): void {
    this.previewContentController.renderInteractiveImageViewer(src, previewPath);
  }

  private refreshActivePreviewRoot(forceRender = false): Promise<void> {
    return this.previewContentController.refreshActivePreviewRoot(forceRender);
  }

  private reportExternalConflict(path: string, reason: string): void {
    const pathKey = filePathKey(path);
    if (this.externalConflictPaths.has(pathKey)) return;
    this.externalConflictPaths.add(pathKey);
    this.appendLspLog({
      kind: "warning",
      source: "workspace",
      message: `${fileNameFromPath(path)} ${reason}; unsaved editor content was preserved.`
    });
    this.setLspStatus({ kind: "error", message: "External change conflicts with unsaved edits" });
  }

  private reportWorkspaceWatchError(error: unknown): void {
    console.error("Workspace watcher failed:", error);
    this.appendLspLog({ kind: "error", source: "workspace", message: `Workspace watcher failed: ${String(error)}` });
  }

  private openWorkspace(selected: string): Promise<void> {
    return this.workspaceLifecycleController.open(selected);
  }


  private startWorkspaceServices(selected: string): Promise<void> {
    return this.workspaceLifecycleController.startServices(selected);
  }



  private importTypsastraProject(archivePath?: string): Promise<void> {
    return this.projectImportController.importProject(archivePath);
  }

  private completeProjectImport(
    imported: ImportedTypsastraProject,
    projectName: string,
  ): Promise<boolean> {
    return this.workspaceLifecycleController.completeImport(imported, projectName);
  }

  private closeOtherTabs(pathToKeep: string): Promise<void> {
    return this.workspaceLifecycleController.closeOtherTabs(pathToKeep);
  }


  private restartWorkspace(): Promise<void> {
    return this.workspaceLifecycleController.restart();
  }


  private openExamplesWorkspace(): Promise<void> {
    return this.workspaceLifecycleController.openExamples();
  }


  private isPinnedMainFile(path: string): boolean {
    return this.pinnedMainFilePath !== null && filePathKey(this.pinnedMainFilePath) === filePathKey(path);
  }

  private async preparePinnedMainTypography(path: string): Promise<DocumentTypography | null | false> {
    try {
      let source = await this.workspaceText(path);
      let config = this.typographyController.fromText(source);
      if (config) {
        const unsupportedInternalScale = await this.typographyController.unsupportedInternalScaleError(config);
        if (unsupportedInternalScale) {
          this.appendLspLog({
            kind: "error",
            source: "typography",
            message: unsupportedInternalScale.message,
          });
          await message(unsupportedInternalScale.message, {
            title: "Unsupported Built-in Font Scale",
            kind: "error",
          });
          config = this.typographyController.resetUnsupportedInternalScales(config, unsupportedInternalScale.fonts);
          const edit = parseTypographyBlock(source)
            ? typographyEdit(source, config)
            : documentScriptsEdit(source, config.fonts);
          source = this.applyEdit(source, edit);
          await this.writeWorkspaceText(path, source);
        }
      }
      if (!this.workspaceRootPath) return await this.typographyController.effective(path, source) ?? config;
      const typography = config ?? { baseSizePt: 11, fonts: [] };
      const status = await this.typographyController.scaledFontSetStatus(typography);
      if (!status.updateRequired) return await this.typographyController.effective(path, source) ?? config;

      const scaledFonts = config?.fonts.filter(font => Math.abs(font.scale - 1) > 0.0001) ?? [];
      if (scaledFonts.length > 0 && status.generationRequired) {
        const outsideFineRange = this.typographyController.scaleRangeWarning(typography) !== null;
        const variantWarning = this.typographyController.variantLimitWarning(status);
        const accepted = await confirm(
          `${fileNameFromPath(path)} contains a document typography directive that requires local font scaling:\n\n${scaledFonts.map(font => `${font.family}: ${font.scale}×`).join("\n")}\n\nTypsastra will generate the fonts in its private global cache before setting this file as main. No font data will be written into the project. Font scaling is intended for fine optical adjustment${outsideFineRange ? "; one or more values also exceed the recommended ±10% range, where accurate representation is not guaranteed and varies between fonts" : ""}.${variantWarning ? `\n\n${variantWarning}` : "\n\nPrepare the fonts and continue?"}`,
          {
            title: "Prepare Document Fonts?",
            kind: "warning",
            okLabel: "Prepare and Continue",
            cancelLabel: "Cancel"
          }
        );
        if (!accepted) return false;
      }

      await this.typographyController.prepareMainFileFonts(typography);
      return await this.typographyController.effective(path, source) ?? config;
    } catch (error) {
      this.appendLspLog({
        kind: "error",
        source: "typography",
        message: `Could not prepare typography for ${fileNameFromPath(path)}: ${String(error)}`
      });
      await message(String(error), { title: "Unable to Prepare Document Fonts", kind: "error" });
      return false;
    }
  }

  private async setPinnedMainFile(path: string | null): Promise<void> {
    const mainChanged = filePathKey(this.pinnedMainFilePath ?? "") !== filePathKey(path ?? "");
    const mainPreviewNotice = path && mainChanged
      ? await this.largePreviewNoticeForRoot(path)
      : null;
    const previewApproved = !mainPreviewNotice
      || this.approvedLargePreviewRoots.has(filePathKey(path ?? ""));
    const typography = path && mainChanged && previewApproved
      ? await this.preparePinnedMainTypography(path)
      : null;
    if (typography === false) return;
    if (typography) this.editorToolbarController.synchronizeDocumentTypography(typography);
    const mainWasAlreadyActive = path !== null
      && this.activeFilePath !== null
      && filePathKey(path) === filePathKey(this.activeFilePath);
    this.pinnedMainFilePath = path;
    if (this.workspaceRootPath) {
      void this.imageToolsController.setWorkspace(this.workspaceRootPath, path).then(() => {
        if (this.sidebarController.activeTool === "images") this.imageToolsController.show();
      });
    }
    if (!path) {
      // The confirmation host is replaced by the no-main preview below. Drop
      // its pending identity as well so selecting the same main can create a
      // fresh actionable confirmation instead of returning a silent block.
      this.blockedLargePreviewRoot = null;
    }
    this.mainDocumentScripts = path
      ? parseDocumentScripts(await invoke<string>("read_workspace_text_prefix", {
          path,
          maxBytes: 65_536,
        }))
      : [];
    this.configureDocumentLanguageTools(this.activeFilePath ? this.editorInstance.state.doc.toString() : "");
    this.saveWorkspaceState();

    if (path && mainChanged && !previewApproved && mainPreviewNotice) {
      this.workspaceServicesDeferredForLargeFile = true;
      this.blockedLargePreviewRoot = path;
      if (this.lspClient) {
        await this.stopTinymistSession("Large Typst file waiting for editor approval");
      }
      const tab = this.openTabs.find(candidate => filePathKey(candidate.path) === filePathKey(path));
      if (tab) {
        this.showLargeFileConfirmation(tab, mainPreviewNotice);
      } else {
        await this.loadFile(path, { temporary: false });
      }
      this.editorSessionController.sortPinnedMainFirst(this.pinnedMainFilePath);
      this.renderEditorTabs();
      if (this.workspaceRootPath) {
        await this.explorer.loadWorkspace(this.workspaceRootPath);
      }
      return;
    }

    if (mainChanged && this.lspClient && previewApproved) {
      this.pdfPreviewRenderController.resetForMainFileChange();
      try {
        // Both refresh policies compile through the same private render
        // mirror. Prepare its stable main root before Tinymist starts so an
        // active included template can immediately restore the main preview.
        await this.prepareRenderProjectIfNeeded();
        await this.restartTinymistSession("Restarting Tinymist for the new main file...");
      } catch (error) {
        this.lspReady = false;
        this.appendDeveloperLog({
          kind: "error",
          source: "lsp",
          message: `Failed to restart Tinymist after changing the main file: ${String(error)}`
        });
      }
    }
    
    if (path && previewApproved) {
      await this.loadFile(path, { temporary: false });
      this.editorSessionController.sortPinnedMainFirst(this.pinnedMainFilePath);
    } else if (!mainChanged) {
      await this.updatePinnedMain(null);
    }
    
    this.renderEditorTabs();
    
    if (this.workspaceRootPath) {
      await this.explorer.loadWorkspace(this.workspaceRootPath);
    }

    if (!previewApproved) {
      this.renderEditorTabs();
      return;
    }

    if (path && !this.getActiveTab()?.contentLoaded) return;
    
    if (mainChanged && (!path || mainWasAlreadyActive)) {
      await this.restoreActiveDocumentAfterTinymistRestart(mainWasAlreadyActive);
    } else {
      await this.refreshActivePreviewRoot(mainWasAlreadyActive);
    }
  }

  private closeProject(options: { confirmUnsaved?: boolean } = {}): Promise<boolean> {
    return this.workspaceLifecycleController.close(options);
  }


  private bindGlobalEvents(): void {
    bindAppEvents({
      previewWindowUpdate: () => {
        if (!this.lastPdfPath) return null;
        return {
          path: this.lastPdfPath,
          identity: this.lastPdfIdentity || this.pdfPreviewSourceMapRootPath || this.previewRootPath || "preview",
          sessionKey: this.lastPdfSessionKey || this.previewSessionKey || this.lastPdfIdentity || "preview",
          surface: this.lastPdfSurface,
          contentMode: this.draftPreviewController.presentedMode,
          draftAssets: this.draftPreviewController.presentedMode === "draft"
            ? [...this.draftPreviewController.assets.values()]
            : [],
          draftAssetRootPath: this.draftPreviewController.presentedMode === "draft"
            ? this.draftPreviewController.assetRootPath ?? undefined
            : undefined,
          draftThumbnailGeneration: this.draftPreviewController.presentedMode === "draft"
            ? this.draftPreviewController.thumbnailGeneration
            : undefined,
        };
      },
      changePreviewContentMode: mode => this.draftPreviewController.changeMode(mode),
      previewContentMode: () => this.draftPreviewController.mode,
      openLastPreviewExternally: () => this.lastPdfPath ? this.openFileExternally(this.lastPdfPath) : undefined,
      handlePdfPreviewClick: point => this.handlePdfPreviewClick(point),
      drainPendingProjectImports: () => this.drainPendingProjectImports(),
      navigateToImageTool: imagePath => this.navigateToImageTool(imagePath),
      beforeUnload: () => {
        this.systemResumeMonitor.stop();
        if (this.sourceMapSessionController.registeredTaskId && this.lspClient) {
          void this.lspClient.stopPreview(this.sourceMapSessionController.registeredTaskId).catch(() => {});
        }
        this.workspaceController.stopWatching();
        void this.saveWorkspaceState();
        this.settingsController.flush();
      },
      dismissSpellcheckTyping: () => this.spellcheckController.dismissActiveTyping(),
      revealCursorInPreview: () => this.revealCursorInPreviewManually(),
      formatActiveDocument: () => this.formatActiveDocument(),
      saveActiveFileAs: () => this.saveActiveFileAs(),
      saveActiveFile: () => this.saveActiveFile(),
      openRecentProject: index => this.recentProjectsController.openAt(index),
      openWorkspace: path => this.openWorkspace(path),
      importProject: () => this.importTypsastraProject(),
      restartWorkspace: () => this.restartWorkspace(),
      closeProject: () => this.closeProject(),
      workspaceRootPath: () => this.workspaceRootPath,
      onNewFileCreated: async path => {
        if (this.workspaceRootPath) await this.explorer.loadWorkspace(this.workspaceRootPath);
        await this.loadFile(path);
      },
      zoomOut: () => this.zoomOut(),
      zoomIn: () => this.zoomIn(),
      zoomToFit: () => this.zoomToFit(),
      recompilePreview: () => this.recompilePreviewManually(),
      showImageHeavyDetails: () => this.draftPreviewController.showImageHeavyDetails(),
      editorHasFocus: () => this.editorInstance.hasFocus,
      initializePreviewPageControls: () => this.initializePreviewPageControls(),
      updatePreviewZoomLabel: () => this.updatePreviewZoomLabel(),
      updateManualForwardSyncAction: () => this.updateManualForwardSyncAction(),
      exportPdf: () => this.projectExportController.exportPdf(),
      exportProject: () => this.projectExportController.exportProjectArchive(),
      exportSourceZip: () => this.projectExportController.exportSourceZip(),
      undo: () => { undo({ state: this.editorInstance.state, dispatch: this.editorInstance.dispatch }); },
      redo: () => { redo({ state: this.editorInstance.state, dispatch: this.editorInstance.dispatch }); },
      foldCurrentFile: () => this.foldCurrentFile(),
      unfoldCurrentFile: () => this.unfoldCurrentFile(),
      toggleSidebar: () => this.sidebarController.toggle(),
      setSidebarTool: tool => this.sidebarController.setTool(tool),
      restoreDefaultLayout: () => this.restoreDefaultLayout(),
      toggleLogConsole: () => this.logConsoleController.toggle(),
      clearLogs: () => this.logConsoleController.clearLogs(),
      restartLsp: async () => {
        this.tinymistPreviewRecoveryAttempts = 0;
        this.logConsoleController.clearAllLogs();
        this.previewFrame.clear();
        try {
          await this.restartTinymistSession("Restarting LSP...");
        } catch (error) {
          this.lspReady = false;
          this.setLspStatus({ kind: "error", message: `LSP restart failed: ${String(error)}` });
          return;
        }
        await this.restoreActiveDocumentAfterTinymistRestart();
      },
      openExamplesWorkspace: () => this.openExamplesWorkspace(),
      startWindowStateMonitor: () => this.windowStateController.start(),
      hasUnsavedChanges: () => this.openTabs.some(tab => tab.isDirty),
      prepareForClose: () => this.appUpdateController.prepareForClose(),
      persistWindowState: () => this.windowStateController.persistNow(),
      wysiwymContainer: this.wysiwymContainer,
      isWysiwymMode: () => this.activeMode === "WYSIWYM",
      handleWysiwymInput: () => this.handleContentMutation(this.mapWysiwymToMarkup()),
      previewPane: this.previewPane,
      handlePreviewSourceLocation: (line, column) => {
        const cursor = this.editorPositionFromSourceLocation(line, column);
        if (this.activeMode === "WYSIWYM") this.switchViewLayoutMode();
        this.previewSyncController.suppressOnce();
        this.editorInstance.dispatch({ selection: { anchor: cursor }, scrollIntoView: true });
        this.editorInstance.focus();
        void this.previewSyncController.renderAtCursor(cursor);
      },
    });
  }

  private async drainPendingProjectImports(): Promise<void> {
    const paths = await invoke<string[]>("take_pending_project_imports").catch(error => {
      console.error("Failed to read pending Typsastra project imports:", error);
      return [];
    });
    for (const path of paths) {
      this.projectImportQueue = this.projectImportQueue
        .then(() => this.importTypsastraProject(path))
        .catch(error => console.error("Queued Typsastra project import failed:", error));
    }
    await this.projectImportQueue;
  }

  private mapMarkupToWysiwym(markup: string) {
    this.wysiwymAdapter.render(markup);
  }

  private editorPositionFromSourceLocation(lineNumber: number, columnNumber: number): number {
    const doc = this.editorInstance.state.doc;
    const line = doc.line(Math.max(1, Math.min(lineNumber, doc.lines)));
    const character = this.utf8ByteOffsetToStringOffset(line.text, Math.max(0, columnNumber - 1));
    return line.from + character;
  }

  private utf8ByteOffsetToStringOffset(text: string, byteOffset: number): number {
    const target = Math.max(0, byteOffset);
    let bytes = 0;
    let offset = 0;

    for (const char of text) {
      const size = this.utf8ByteLength(char);
      if (bytes + size > target) break;
      bytes += size;
      offset += char.length;
    }

    return offset;
  }

  private mapWysiwymToMarkup(): string {
    return this.wysiwymAdapter.serialize();
  }



  private getCacheRootPath(): string | null {
    if (!this.workspaceRootPath) return null;
    return `${this.workspaceRootPath}/.typsastra/cache`.replace(/\\/g, "/");
  }

  private mapToOriginalPath(cachePath: string): string {
    if (!this.workspaceRootPath) {
      return cachePath;
    }
    const prefix = `${this.workspaceRootPath}/.typsastra/cache/render/`.replace(/\\/g, "/").toLowerCase();
    const cleanCache = cachePath.replace(/\\/g, "/").toLowerCase();
    if (cleanCache.startsWith(prefix)) {
      const relPath = cachePath.substring(prefix.length);
      return `${this.workspaceRootPath}/${relPath}`;
    }
    return cachePath;
  }

  private isRenderCachePath(path: string): boolean {
    if (!this.workspaceRootPath) return false;
    const prefix = `${this.workspaceRootPath}/.typsastra/cache/render/`.replace(/\\/g, "/").toLowerCase();
    return path.replace(/\\/g, "/").toLowerCase().startsWith(prefix);
  }

  private async pdfGeneratedPreviewText(originalPath: string): Promise<string> {
    return this.pdfPreviewPreparationController.generatedPreviewText(originalPath);
  }

  private async getLspUriAndContent(path: string, originalContent: string): Promise<{ uri: string; content: string } | null> {
    if (!isTypstDocumentPath(path)) return null;
    return { uri: filePathToUri(path), content: originalContent };
  }

  private getActiveLspUri(): string {
    if (!this.activeFilePath || !isTypstDocumentPath(this.activeFilePath)) return "";
    return filePathToUri(this.activeFilePath);
  }

  private async mapCacheLspPositionToOriginalEditorOffset(
    cacheRelPath: string,
    position: LspSourcePosition,
    cacheContent: string
  ): Promise<number | null> {
    if (!this.lspClient) return null;
    const lines = cacheContent.split(/\r?\n/);
    let utf16Offset = 0;
    for (let i = 0; i < Math.min(position.line, lines.length); i++) {
      utf16Offset += lines[i].length + 1;
    }
    if (position.line < lines.length) {
      utf16Offset += Math.min(position.character ?? 0, lines[position.line].length);
    }
    const subStr = cacheContent.substring(0, utf16Offset);
    const byteOffset = new TextEncoder().encode(subStr).length;

    const cacheRoot = this.getCacheRootPath();
    if (!cacheRoot) return null;

    try {
      const originalByteOffset = await invoke<number | null>("map_generated_to_source", {
        cacheRoot,
        relativePath: cacheRelPath,
        generatedOffset: byteOffset
      });
      if (originalByteOffset === null || originalByteOffset === undefined) return null;

      const originalContent = this.editorInstance.state.doc.toString();
      const originalBytes = new TextEncoder().encode(originalContent);
      const originalSubBytes = originalBytes.slice(0, originalByteOffset);
      const originalSubStr = new TextDecoder().decode(originalSubBytes);
      return Math.max(0, Math.min(originalSubStr.length, originalContent.length));
    } catch (e) {
      console.error("Error mapping offset:", e);
      return null;
    }
  }

  private prepareRenderProjectIfNeeded(): Promise<void> {
    return this.pdfPreviewPreparationController.prepareProjectIfNeeded();
  }

}
