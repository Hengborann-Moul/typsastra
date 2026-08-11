import { listen } from "@tauri-apps/api/event";
import { confirm, message, open, save } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { dirname, join } from "@tauri-apps/api/path";
import { EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, lineNumbers } from "@codemirror/view";
import { undo, redo, undoDepth } from "@codemirror/commands";
import { foldAll, foldEffect, foldedRanges, indentUnit, unfoldAll, unfoldEffect } from "@codemirror/language";
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
import { isTinymistStoppedRequestError, type EditorTextEdit, type LspDiagnostic, type LspInverseSyncResult, type LspLogEntry, type LspSourcePosition, type LspStatus } from "./compiler/lsp";
import {
  parsePreviewCompilerFailure,
  relocatePreviewCompilerFailureMessage,
  type PreviewCompilerFailure,
} from "./compiler/previewError";
import type { AppSettings, DeveloperLogCategory, PreviewRenderMode, ThemeName } from "./settings";
import { SettingsController } from "./settingsController";
import { fileNameFromPath, filePathFromUri, filePathKey, filePathToUri, nativeFilePath, relativeFilePath, remapFilePath } from "./platform/paths";
import { isBinaryImagePath, isMarkdownDocumentPath, isSupportedInAppPath, isTypstDocumentPath, fileExtension } from "./platform/fileTypes";
import { WysiwymAdapter } from "./wysiwym/adapter";
import type { PreviewFrame, PreviewClickPoint, PreviewInteractionStatus, PreviewPageStatus, PreviewSurface } from "./preview/previewFrame";
import type { MarkdownPreviewFrame, MarkdownResource } from "./preview/markdownPreviewFrame";
import { PreviewController } from "./preview/previewController";
import { PreviewSyncController } from "./preview/previewSyncController";
import { SourceMapSessionController } from "./preview/sourceMapSessionController";
import { ImagePreviewController } from "./preview/imagePreviewController";
import { activeFileCanRenderPreview, allowsStandalonePreview, documentScriptsForPreviewContext, participatesInPreviewCompilation, previewLspMainPath, previewRefreshStyle, previewSessionIdentity, researchDocumentIdentity, tinymistPreviewPreferredSourceColumn, usesTemplateAwareStandaloneRoot, type PreviewTarget, type PreviewRefreshStyle } from "./preview/previewPolicy";
import { LogConsoleController, type LogConsoleEntryInput } from "./diagnostics/logConsoleController";
import { DiagnosticsController } from "./diagnostics/diagnosticsController";
import {
  PreviewFailureController,
  type PreviewPackageFailureHint,
} from "./diagnostics/previewFailureController";
import { EditorFontManager } from "./editor/fontManager";
import { TabStripController } from "./editor/tabStripController";
import { createAppIcon, updateMaximizeIcon } from "./ui/icons";
import { installModalFocusTrap } from "./ui/modalFocus";
import { AppDialogController } from "./ui/appDialog";
import { isAltGraphKeyboardEvent } from "./ui/keyboardModifiers";
import {
  TYPSASTRA_GREEN,
  TYPSASTRA_GREEN_RIPPLE_FILL,
  TYPSASTRA_GREEN_RIPPLE_SHADOW
} from "./ui/brandColors";
import { LayoutController } from "./layout/layoutController";
import {
  workspaceRestoreCandidates,
  type WorkspaceMetadata
} from "./workspace/workspaceStateStore";
import { RecentProjectsController, recentProjectShortcutIndex } from "./workspace/recentProjectsController";
import {
  type WorkspaceChange
} from "./workspace/workspaceWatcher";
import { WorkspaceController } from "./workspace/workspaceController";
import { ProjectImportController } from "./workspace/projectImportController";
import { ExternalWorkspaceController } from "./workspace/externalWorkspaceController";
import { formatFileSize, largeFileOpeningNotice, largeMainPreviewOpeningNotice, type LargeFileOpeningNotice } from "./workspace/largeFileOpening";
import { installWelcomeKeyboardNavigation } from "./workspace/welcomeNavigation";
import { PerformanceController } from "./performance/performanceController";
import { EditorToolbarController } from "./editor/toolbarController";
import { ContextMenuController } from "./components/contextMenuController";
import { ToolchainController, type ToolchainStatus } from "./toolchain/toolchainController";
import { DocumentOutlineController, type DocumentHeading } from "./outline/documentOutline";
import { WindowStateController } from "./window/windowStateController";
import {
  parseTypographyBlock,
  parseDocumentScripts,
  documentScriptsEdit,
  typographyEdit,
  type DocumentScriptFont,
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
import { releaseSummaryForVersion, shouldShowReleaseSummary } from "./releaseNotes";
import { WebviewStorageController } from "./webviewStorageController";
import { SystemResumeMonitor } from "./platform/systemResume";
import { setImageOptimizationWarningsEffect, type ImageOptimizationWarning } from "./editor/imageWarnings";
import {
  captureEditorUndoHistory,
  createTabEditorState,
  type EditorUndoHistory,
} from "./editor/tabHistory";

import {
  ensureTypographyTemplateApplication,
  findLocalTemplateApplication,
  findTemplateFunctionName,
  newTypographyTemplate,
  templatePreviewSource,
  templateTypographyEdit
} from "./editor/templateTypography";

type EditorMode = "CODE" | "WYSIWYM";

type PreviewImageReference = {
  sourcePath: string;
  fromUtf16: number;
  toUtf16: number;
  line: number;
  column: number;
};

type PreviewImageAsset = {
  path: string;
  width: number;
  height: number;
  sourceBytes: number;
  estimatedDecodedBytes: number;
  format: string;
  modifiedMs: number;
  references: PreviewImageReference[];
};

type PreviewImageProfile = {
  images: PreviewImageAsset[];
  uniqueImageCount: number;
  referenceCount: number;
  totalSourceBytes: number;
  estimatedTotalDecodedBytes: number;
};

const DEFAULT_INPUT_WIDTH_PCT = 50;
const DEFAULT_PREVIEW_WIDTH_PCT = 100 - DEFAULT_INPUT_WIDTH_PCT;
const DEFAULT_EXPLORER_WIDTH_PX = 250;
const RELEASE_SUMMARY_SEEN_KEY_PREFIX = "typsastra:release-summary-seen";
const MAX_RECOMMENDED_DECODED_PREVIEW_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_RECOMMENDED_TOTAL_DECODED_PREVIEW_IMAGE_BYTES = 256 * 1024 * 1024;
const MAX_RECOMMENDED_PREVIEW_IMAGE_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_RECOMMENDED_UNIQUE_PREVIEW_IMAGES = 50;
const AGGREGATE_IMAGE_CONTRIBUTOR_BYTES = 32 * 1024 * 1024;
const MAX_RECOMMENDED_SINGLE_IMAGE_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_AGGREGATE_IMAGE_OPTIMIZATION_SUGGESTIONS = 5;
const PDF_TRANSPORT_MODE = (
  import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }
).env?.VITE_PDF_TRANSPORT === "full"
  ? "full-buffer"
  : "range";

class PreviewPreparationInterrupted extends Error {
  constructor() {
    super("Preview preparation was superseded by editor input.");
  }
}

function isPreviewOnlyWindow(): boolean {
  return new URLSearchParams(window.location.search).get("mode") === "preview";
}


type ExamplesWorkspace = {
  workspacePath: string;
  entryPath: string;
};


type EditorTab = {
  path: string;
  content: string;
  savedContent: string;
  contentLoaded: boolean;
  isDirty: boolean;
  previewRootPath: string | null;
  previewMainPath: string | null;
  previewTaskId: string | null;
  previewSessionKey: string | null;
  previewImported: boolean;
  previewStandalone: boolean;
  previewDisabled: boolean;
  version: number;
  latestVersion: number;
  selectionAnchor: number;
  selectionHead: number;
  scrollTop?: number;
  scrollLeft?: number;
  scrollSnapshot?: ReturnType<EditorView["scrollSnapshot"]>;
  foldRanges: EditorFoldRange[] | null;
  foldStateExplicit: boolean;
  sizeBytes?: number;
  lineCount?: number;
  temporary?: boolean;
  undoHistory?: EditorUndoHistory;
};

type SaveIntent = "manual" | "automatic";

type PreviewSessionState = Pick<
  EditorTab,
  "previewRootPath" | "previewMainPath" | "previewTaskId" | "previewSessionKey" | "previewImported" | "previewStandalone" | "previewDisabled"
>;

type PdfUpdatePayload = {
  path: string;
  identity: string;
  sessionKey: string;
  surface: PreviewSurface;
  contentMode?: PreviewContentMode;
  draftAssets?: DraftImageAsset[];
  draftAssetRootPath?: string;
  draftThumbnailGeneration?: number;
};

type PreviewContentMode = "normal" | "draft";

type UndockedPreviewAction = "export-pdf" | "open-external";

type DraftImageReference = {
  sourcePath: string;
  fromUtf16: number;
  toUtf16: number;
};

type DraftImageAsset = {
  id: string;
  path: string;
  mimeType: string;
  width: number;
  height: number;
  sourceBytes: number;
  estimatedDecodedBytes: number;
  references: DraftImageReference[];
};

type DraftImageDiagnostic = DraftImageReference & { reason: string };

type DraftThumbnailStatus = {
  status: "pending" | "generating" | "ready" | "failed";
  path?: string;
  mimeType?: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceBytes: number;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  thumbnailBytes?: number;
  queueClass: string;
};

type DraftThumbnailQueueSummary = {
  generation: number;
  cacheHits: number;
  queued: number;
};

type DraftThumbnailQueueMetric = {
  generation: number;
  status: "completed" | "cancelled" | "superseded";
  totalImages: number;
  cacheHits: number;
  generated: number;
  failed: number;
  skipped: number;
  outputBytes: number;
  decodeMs: number;
  resizeMs: number;
  encodeMs: number;
  totalMs: number;
};

type RenderPreparationResult = {
  generatedEntryFile: string;
  changedFiles: string[];
  warnings: Array<{ filePath: string; message: string }>;
  draftAssets: DraftImageAsset[];
  draftDiagnostics: DraftImageDiagnostic[];
  draftCacheHits: number;
  draftReachableFiles: string[];
  timings: RenderPreparationTimings;
};

type RenderPreparationTimings = {
  totalMs: number;
  setupMs: number;
  cleanupMs: number;
  discoveryMs: number;
  typProcessingMs: number;
  assetSyncMs: number;
  discoveredFiles: number;
  typFiles: number;
  assetFiles: number;
};

type RenderPreparationFileResult = {
  generatedPath: string;
  preparedText: string;
  draftAssets: DraftImageAsset[];
  draftDiagnostics: DraftImageDiagnostic[];
  draftCacheHit: boolean;
};

type PreparedPdfPreview = {
  path: string;
  documentRootPath: string;
  changedPaths: string[];
  draftAssets: Map<string, DraftImageAsset>;
  draftDiagnostics: DraftImageDiagnostic[];
  draftProjectCacheHits: number;
  draftOverlayCacheHits: number;
  draftOverlayPreparations: number;
  projectPreparationMs: number;
  overlayPreparationMs: number;
  backendTimings: RenderPreparationTimings;
  reachableSourcePaths: string[];
};

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

function ensureEditorCaretRippleStyle(): void {
  if (document.getElementById("typsastra-editor-caret-ripple-style")) return;
  const style = document.createElement("style");
  style.id = "typsastra-editor-caret-ripple-style";
  style.textContent = `
    @keyframes typsastra-editor-caret-ripple {
      0% { opacity: 0; transform: scale(.55); box-shadow: 0 0 0 0 rgba(61,180,137,.38); }
      12% { opacity: 1; }
      100% { opacity: 0; transform: scale(3.1); box-shadow: 0 0 0 14px rgba(61,180,137,0); }
    }
  `;
  document.head.appendChild(style);
}

export class TypsastraWorkspaceController {
  private readonly startupStart = performance.now();
  private activeMode: EditorMode = "CODE";
  private activeFilePath: string | null = null;
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
  private systemResumeRecoveryActive = false;
  private workspaceServicesDeferredForLargeFile = false;
  private readonly approvedLargePreviewRoots = new Set<string>();
  private readonly inspectedPreviewRoots = new Set<string>();
  private blockedLargePreviewRoot: string | null = null;
  private guardrailAlignmentObserver: ResizeObserver | null = null;
  private previewImageProfile: PreviewImageProfile | null = null;
  private previewContentMode: PreviewContentMode = "normal";
  private presentedPreviewContentMode: PreviewContentMode = "normal";
  private previewContentModeCompiling = false;
  private previewScrollTop = 0;
  private previewScrollSaveTimer: number | null = null;
  private draftImageAssets = new Map<string, DraftImageAsset>();
  private draftImageDiagnostics: DraftImageDiagnostic[] = [];
  private draftAssetRootPath: string | null = null;
  private draftThumbnailDocumentRootPath: string | null = null;
  private draftThumbnailGeneration = 0;
  private wordWrapDeferredForResize = false;
  private recommendedWorkspaceToolchain: { tinymistVersion: string; typstVersion: string } | null = null;
  private selectedWorkspaceToolchain: { tinymistVersion: string; typstVersion: string } | null = null;
  private currentVersion = 1;
  private isLoadingFile = false;
  private readonly lspSyncDebounceMs = 50;
  private pendingEditorMutationTimer: number | null = null;
  private pendingEditorMutation: { path: string; doc: Text } | null = null;
  private forwardSyncDebounceMs = 120;
  private latestDocumentVersion = 1;
  private diagnosticWaitStartedAt: number | null = null;
  private openTabs: EditorTab[] = [];
  private readonly detectedPlainTextPaths = new Set<string>();
  private readonly classifiedUnknownPaths = new Set<string>();
  private suppressFoldStatePersistence = false;
  private documentOutlineUpdateTimer: number | null = null;
  private documentOutlineUpdateGeneration = 0;
  private readonly openedDocumentUris = new Set<string>();
  private lastKhmerRenderPrepState: boolean | undefined = undefined;
  private lastPreviewRenderMode: PreviewRefreshStyle | undefined = undefined;
  private projectImportQueue: Promise<void> = Promise.resolve();
  private saveInProgress: Promise<void> | null = null;
  private saveInProgressIntent: SaveIntent | null = null;
  private autoSaveTimer: number | null = null;
  private pdfPreviewGeneration = 0;
  private pdfLoadRequestGeneration = 0;
  private readonly blockedLargePdfPaths = new Set<string>();
  private previewPageStatus: PreviewPageStatus = { currentPage: 0, pageCount: 0 };
  private horizontalPaneResizeActive = false;
  private readonly horizontalPaneResizeWaiters = new Set<() => void>();
  private pdfPreviewSourceMapRootPath: string | null = null;
  private pdfPreviewSourceMapTaskId: string | null = null;
  private pdfPreviewGeneratedFiles = new Map<string, { generatedPath: string; preparedText: string }>();
  private pdfPreviewTimer: number | null = null;
  private pdfPreviewScheduleGeneration = 0;
  private pdfPreparationRevision = 0;
  private pdfPreviewRunning = false;
  private queuedPdfPreviewContents: string | null = null;
  private queuedPdfPreviewForced = false;
  private typographyScaleCheckTimer: number | null = null;
  private typographyScaleCheckGeneration = 0;
  private typographyScaleConfirmationOpen = false;
  private lastTypographyInternalScaleError = "";
  private suppressTypographyScaleConfirmation = false;
  private acceptedTypographyScales = new Map<string, DocumentScriptFont[]>();
  private typographyFontUpdateInProgress = false;
  private exportInProgress = false;
  private deferredTypographyPreviewContents: string | null = null;
  private lastPdfPath = "";
  private lastPdfIdentity = "";
  private lastPdfSessionKey = "";
  private lastPdfSurface: PreviewSurface = "live";
  private pdfPreviewFailureAt: number | null = null;
  private lastFailedPreviewContents: string | null = null;
  private lastPreviewRecoveryRequestedContents: string | null = null;
  private tinymistPreviewRecoveryAttempts = 0;
  private tinymistPreviewRecovery: Promise<boolean> | null = null;
  private saveMemoryDiagnosticGeneration = 0;
  private readonly externalConflictPaths = new Set<string>();
  private externalPreviewRefreshPending = false;
  private readonly managedPreviewPdfPathKeys = new Set<string>();
  private readonly managedImageToolPathKeys = new Set<string>();
  private readonly settingsController = new SettingsController(
    settings => this.applySettingsToRuntime(settings),
    providers => this.handleLanguageProvidersChanged(providers),
    () => this.handlePrivateFontDirectoriesChanged(),
    () => this.handlePrivateFontDirectoriesChanged()
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
  });
  private isComposing = false;
  private readonly editorInputKeysHeld = new Set<string>();
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
  private surroundWithOptions: readonly SurroundWithOption[] = SURROUND_WITH_OPTIONS;
  private surroundWithDiscoveryGeneration = 0;

  private codePane = document.getElementById("code-editor-pane")!;
  private editorTabBar = document.getElementById("editor-tab-bar")!;
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
    loadDraftImage: id => this.loadDraftPreviewImage(id),
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
      interactionBlocked: this.horizontalPaneResizeActive,
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
    () => this.beginHorizontalPaneResize(),
    () => this.endHorizontalPaneResize()
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
      previewContentMode: this.previewContentMode,
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
  private readonly typographyController = new TypographyController({
    getWorkspaceRootPath: () => this.workspaceRootPath,
    readWorkspaceText: path => this.workspaceText(path),
    logWarning: message => this.appendDeveloperLog({
      kind: "warning",
      source: "typography",
      message,
    }),
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
    onWorkspacePrivateFontDirectoriesChanged: () => this.handlePrivateFontDirectoriesChanged()
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
  private readonly appUpdateController = new AppUpdateController(
    () => this.openTabs.some(tab => tab.isDirty),
    this.appDialogController
  );
  private readonly webviewStorageController = new WebviewStorageController(() =>
    this.pdfPreviewRunning
    || this.typographyFontUpdateInProgress
    || this.exportInProgress
    || this.settingsController.isLanguageProviderOperationInProgress
    || this.toolchainController.isBusy
    || this.appUpdateController.isInstalling
  );
  private readonly systemResumeMonitor = new SystemResumeMonitor(suspendedMs => {
    void this.recoverAfterSystemResume(suspendedMs);
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
    this.updateImageHeavyPreviewWarning(this.previewImageProfile);
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
    await this.showReleaseSummaryIfNeeded();
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
      const requestedMode = this.previewContentMode === "draft" ? "normal" : "draft";
      this.previewContentMode = requestedMode;
      this.updatePreviewContentModeControl(true);
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
      this.previewContentMode = update.contentMode ?? "normal";
      this.presentedPreviewContentMode = update.contentMode ?? "normal";
      this.draftImageAssets = new Map((update.draftAssets ?? []).map(asset => [asset.id, asset]));
      this.draftAssetRootPath = update.draftAssetRootPath ?? null;
      // Thumbnail status requests are validated against the workspace root.
      // The undocked window has no workspace bootstrap of its own, so inherit
      // the already validated root carried with the Draft manifest.
      this.workspaceRootPath = update.draftAssetRootPath ?? null;
      this.draftThumbnailGeneration = update.draftThumbnailGeneration ?? 0;
      this.updatePreviewContentModeControl(false);
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
      if (this.pdfPreviewTimer) {
        window.clearTimeout(this.pdfPreviewTimer);
        this.pdfPreviewTimer = null;
      }
      this.queuedPdfPreviewContents = null;
      this.queuedPdfPreviewForced = false;
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
        if (!this.suppressFoldStatePersistence && update.transactions.some(transaction =>
          transaction.effects.some(effect => effect.is(foldEffect) || effect.is(unfoldEffect))
        )) {
          const tab = this.getActiveTab();
          if (tab) {
            tab.foldStateExplicit = true;
            tab.foldRanges = this.collectCurrentFoldRanges();
            void this.saveWorkspaceState();
          }
        }
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
        && metric.generation !== this.draftThumbnailGeneration
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
    this.editorInstance.contentDOM.addEventListener("keydown", event => {
      if (!this.isEditorMutationKey(event)) return;
      this.editorInputKeysHeld.add(event.code || event.key);
    }, { capture: true });
    
    this.editorInstance.contentDOM.addEventListener("keyup", event => {
      if (!this.isEditorMutationKey(event)) return;
      this.editorInputKeysHeld.delete(event.code || event.key);
      if (this.editorInputKeysHeld.size === 0 && this.pendingEditorMutation) this.restartEditorMutationTimer();
    }, { capture: true });
    
    window.addEventListener("blur", () => {
      this.editorInputKeysHeld.clear();
      if (this.pendingEditorMutation) this.restartEditorMutationTimer();
    });
    
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

  private sortPinnedMainTabFirst() {
    if (!this.pinnedMainFilePath) return;
    const index = this.openTabs.findIndex(tab => filePathKey(tab.path) === filePathKey(this.pinnedMainFilePath!));
    if (index > 0) {
      const [pinnedTab] = this.openTabs.splice(index, 1);
      pinnedTab.temporary = false; // Pinned is permanent
      this.openTabs.unshift(pinnedTab);
    }
  }

  private renderEditorTabs() {
    this.sortPinnedMainTabFirst();
    this.editorTabBar.innerHTML = "";

    for (const tab of this.openTabs) {
      const isPinnedMain = this.pinnedMainFilePath && filePathKey(tab.path) === filePathKey(this.pinnedMainFilePath);
      const tabButton = document.createElement("button");
      tabButton.className = `editor-tab${tab.path === this.activeFilePath ? " active" : ""}${tab.isDirty ? " dirty" : ""}${tab.temporary ? " temporary" : ""}${isPinnedMain ? " pinned-main-tab" : ""}`;
      tabButton.type = "button";
      tabButton.role = "tab";
      tabButton.title = tab.path;
      tabButton.setAttribute("aria-selected", String(tab.path === this.activeFilePath));
      tabButton.dataset.path = tab.path;

      const title = document.createElement("span");
      title.className = "editor-tab-title";
      title.textContent = fileNameFromPath(tab.path);
      tabButton.appendChild(title);

      const dirtyDot = document.createElement("span");
      dirtyDot.className = "editor-tab-dirty";
      dirtyDot.setAttribute("aria-hidden", "true");
      tabButton.appendChild(dirtyDot);

      if (!isPinnedMain) {
        const closeButton = document.createElement("span");
        closeButton.className = "editor-tab-close";
        closeButton.appendChild(createAppIcon("x", { size: 13 }));
        closeButton.title = "Close";
        closeButton.setAttribute("aria-label", `Close ${fileNameFromPath(tab.path)}`);
        tabButton.appendChild(closeButton);

        closeButton.addEventListener("click", (event) => {
          event.stopPropagation();
          void this.closeEditorTab(tab.path);
        });
      }

      tabButton.addEventListener("click", () => {
        void this.activateEditorTab(tab.path).catch(error => {
          console.error("Failed to load restored tab:", tab.path, error);
          void message(`Could not open ${fileNameFromPath(tab.path)}: ${String(error)}`, {
            title: "Unable to Open File",
            kind: "error"
          });
        });
      });

      tabButton.addEventListener("dblclick", () => {
        void this.promoteToPermanent(tab);
      });

      this.editorTabBar.appendChild(tabButton);
    }
  }

  private async promoteToPermanent(tab: EditorTab) {
    if (!tab.temporary) return;
    tab.temporary = false;
    this.renderEditorTabs();
    this.saveWorkspaceState();
  }

  private getActiveTab(): EditorTab | null {
    if (!this.activeFilePath) return null;
    const activeKey = filePathKey(this.activeFilePath);
    return this.openTabs.find((tab) => filePathKey(tab.path) === activeKey) ?? null;
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
    const ranges: EditorFoldRange[] = [];
    if (!this.editorInstance) return ranges;

    const docLength = this.editorInstance.state.doc.length;
    foldedRanges(this.editorInstance.state).between(0, docLength, (from, to) => {
      if (from < to) {
        ranges.push({ from, to });
      }
    });

    return ranges;
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
    this.suppressFoldStatePersistence = true;
    try {
      if (!tab.foldStateExplicit) {
        tab.foldRanges = [];
        this.applyFoldRanges([]);
      } else {
        const ranges = this.normalizeFoldRanges(tab.foldRanges, this.editorInstance.state.doc.length);
        tab.foldRanges = ranges;
        this.applyFoldRanges(ranges);
      }
    } finally {
      this.suppressFoldStatePersistence = false;
    }
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
    foldAll(this.editorInstance);
    this.editorInstance.focus();
  }

  private unfoldCurrentFile(): void {
    if (!this.getActiveTab() || !this.isInternallySupportedPath(this.activeFilePath ?? "") || isBinaryImagePath(this.activeFilePath ?? "") || fileExtension(this.activeFilePath ?? "") === "pdf") return;
    const tab = this.getActiveTab();
    if (tab) tab.foldStateExplicit = true;
    unfoldAll(this.editorInstance);
    this.editorInstance.focus();
  }

  private applyFoldRanges(ranges: EditorFoldRange[]) {
    const effects = [];
    const docLength = this.editorInstance.state.doc.length;

    foldedRanges(this.editorInstance.state).between(0, docLength, (from, to) => {
      effects.push(unfoldEffect.of({ from, to }));
    });

    for (const range of this.normalizeFoldRanges(ranges, docLength)) {
      effects.push(foldEffect.of(range));
    }

    if (effects.length > 0) {
      this.editorInstance.dispatch({ effects });
    }
  }

  private normalizeFoldRanges(value: unknown, docLength: number): EditorFoldRange[] {
    if (!Array.isArray(value)) return [];

    const ranges: EditorFoldRange[] = [];

    for (let index = 0; index < value.length; index++) {
      const item = value[index];
      const range = typeof item === "object" && item !== null
        ? item as Partial<EditorFoldRange>
        : typeof item === "number" && typeof value[index + 1] === "number"
          ? { from: item, to: value[++index] as number }
          : null;

      if (
        range &&
        typeof range.from === "number" &&
        typeof range.to === "number" &&
        range.from >= 0 &&
        range.to <= docLength &&
        range.from < range.to
      ) {
        ranges.push({ from: range.from, to: range.to });
      }
    }

    return ranges;
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

  private isEditorMutationKey(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey) return false;
    if (event.altKey && !isAltGraphKeyboardEvent(event)) return false;
    return event.key.length === 1
      || event.key === "Backspace"
      || event.key === "Delete"
      || event.key === "Enter"
      || event.key === "Tab";
  }
  
  private restartEditorMutationTimer(): void {
    if (this.pendingEditorMutationTimer !== null) window.clearTimeout(this.pendingEditorMutationTimer);
  
    const delay = this.effectivePreviewRenderMode === "on-type"
      ? Math.min(300, this.settingsController.value.preview.syncDebounceMs)
      : 300;
  
    this.pendingEditorMutationTimer = window.setTimeout(() => {
      this.pendingEditorMutationTimer = null;
  
      if (this.editorInputKeysHeld.size > 0) return;
  
      this.flushEditorContentMutation(delay);
    }, delay);
  }

  private scheduleEditorContentMutation(doc: Text): void {
    if (!this.activeFilePath) return;
    const startsTypingSequence = this.pendingEditorMutation === null;
    if (
      startsTypingSequence
      && this.effectivePreviewRenderMode === "on-type"
      && activeFileCanRenderPreview(
        this.activeFilePath,
        this.pinnedMainFilePath,
        this.previewImported,
        this.previewDisabled
      )
    ) {
      // Cancel stale scheduled or preparatory work once at the beginning of a
      // typing burst. Further keystrokes only replace the in-memory snapshot.
      this.invalidatePreviewWork("editor input");
    }
    this.pendingEditorMutation = { path: this.activeFilePath, doc };
    this.restartEditorMutationTimer();
  }

  private flushEditorContentMutation(previewDebounceElapsedMs = 0): void {
    if (this.pendingEditorMutationTimer !== null) {
      window.clearTimeout(this.pendingEditorMutationTimer);
      this.pendingEditorMutationTimer = null;
    }
    const pending = this.pendingEditorMutation;
    this.pendingEditorMutation = null;
    if (
      !pending
      || !this.activeFilePath
      || filePathKey(pending.path) !== filePathKey(this.activeFilePath)
      || pending.doc !== this.editorInstance.state.doc
    ) return;

    const currentText = pending.doc.toString();
    this.configureDocumentLanguageTools(currentText);
    this.editorFontManager.scheduleDocumentUpdate(currentText);
    this.handleContentMutation(currentText, previewDebounceElapsedMs);
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
        const acceptedScale = this.acceptedTypographyScales.get(filePathKey(tab.path));
        this.acceptedTypographyScales.delete(filePathKey(tab.path));
        if (acceptedScale !== undefined) {
          this.acceptedTypographyScales.set(filePathKey(renamedPath), acceptedScale);
        }
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
      this.pdfPreviewGeneratedFiles.clear();
      this.pdfPreparationRevision += 1;
      this.pdfPreviewScheduleGeneration += 1;
      if (this.pdfPreviewTimer !== null) {
        window.clearTimeout(this.pdfPreviewTimer);
        this.pdfPreviewTimer = null;
      }

      if (this.activeFilePath) {
        this.explorer.setActiveFile(this.activeFilePath);
        this.activateSpellcheckDocument(this.activeFilePath);
      }
      this.sortPinnedMainTabFirst();
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
    this.acceptedTypographyScales.delete(filePathKey(path));
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

  private recommendedImageOptimizationAssets(profile: PreviewImageProfile): PreviewImageAsset[] {
    const selected = new Map<string, PreviewImageAsset>();
    const select = (image: PreviewImageAsset) => selected.set(filePathKey(image.path), image);

    for (const image of profile.images) {
      if (
        image.estimatedDecodedBytes > MAX_RECOMMENDED_DECODED_PREVIEW_IMAGE_BYTES
        || image.sourceBytes > MAX_RECOMMENDED_SINGLE_IMAGE_SOURCE_BYTES
      ) {
        select(image);
      }
    }

    if (profile.estimatedTotalDecodedBytes > MAX_RECOMMENDED_TOTAL_DECODED_PREVIEW_IMAGE_BYTES) {
      const remaining = Math.max(0, MAX_AGGREGATE_IMAGE_OPTIMIZATION_SUGGESTIONS - selected.size);
      profile.images
        .filter(image =>
          image.estimatedDecodedBytes > AGGREGATE_IMAGE_CONTRIBUTOR_BYTES
          && !selected.has(filePathKey(image.path))
        )
        .sort((left, right) => right.estimatedDecodedBytes - left.estimatedDecodedBytes)
        .slice(0, remaining)
        .forEach(select);
    }

    return [...selected.values()].sort(
      (left, right) => right.estimatedDecodedBytes - left.estimatedDecodedBytes
    );
  }

  private imageOptimizationMessage(
    image: PreviewImageAsset,
    profile: PreviewImageProfile
  ): string {
    const reasons: string[] = [];
    if (image.estimatedDecodedBytes > MAX_RECOMMENDED_DECODED_PREVIEW_IMAGE_BYTES) {
      reasons.push("Its decoded size exceeds the recommended per-image preview budget.");
    } else if (
      profile.estimatedTotalDecodedBytes > MAX_RECOMMENDED_TOTAL_DECODED_PREVIEW_IMAGE_BYTES
      && image.estimatedDecodedBytes > AGGREGATE_IMAGE_CONTRIBUTOR_BYTES
    ) {
      reasons.push(`It is a major contributor to the document's estimated ${formatFileSize(profile.estimatedTotalDecodedBytes)} decoded image total.`);
    }
    if (image.sourceBytes > MAX_RECOMMENDED_SINGLE_IMAGE_SOURCE_BYTES) {
      reasons.push(`Its ${formatFileSize(image.sourceBytes)} source file is unusually large.`);
    }
    return [
      `${fileNameFromPath(image.path)} is ${image.width.toLocaleString()} × ${image.height.toLocaleString()} pixels`,
      `and may require about ${formatFileSize(image.estimatedDecodedBytes)} when decoded.`,
      ...reasons,
      "Downscale its pixel dimensions to reduce live-preview memory and compilation work.",
      "Compressing or re-encoding it can reduce the source file and may reduce the exported PDF size."
    ].join(" ");
  }

  private publishImageOptimizationWarnings(profile = this.previewImageProfile): void {
    const optimizationCandidates = profile
      ? this.recommendedImageOptimizationAssets(profile)
      : [];
    this.logConsoleController.setImageOptimizationIssues(optimizationCandidates.map(image => ({
      kind: "warning",
      channel: "images",
      counted: true,
      source: "image optimization",
      filePath: image.path,
      fileName: fileNameFromPath(image.path),
      message: this.imageOptimizationMessage(image, profile!),
      locations: image.references.map(reference => ({
        filePath: reference.sourcePath,
        fileName: fileNameFromPath(reference.sourcePath),
        line: reference.line,
        column: reference.column,
        offset: reference.fromUtf16,
        toOffset: reference.toUtf16
      }))
    })));

    if (!this.editorInstance) return;
    const activePath = this.activeFilePath;
    if (!profile || !activePath || !isTypstDocumentPath(activePath)) {
      this.editorInstance.dispatch({ effects: setImageOptimizationWarningsEffect.of([]) });
      return;
    }
    const activeKey = filePathKey(activePath);
    const warnings: ImageOptimizationWarning[] = [];
    for (const image of optimizationCandidates) {
      const message = this.imageOptimizationMessage(image, profile);
      for (const reference of image.references) {
        if (filePathKey(reference.sourcePath) !== activeKey) continue;
        warnings.push({
          from: reference.fromUtf16,
          to: reference.toUtf16,
          message,
          imagePath: image.path,
        });
      }
    }
    this.editorInstance.dispatch({
      effects: setImageOptimizationWarningsEffect.of(warnings)
    });
  }

  private async inspectPreviewImageProfile(rootPath: string | null): Promise<PreviewImageProfile | null> {
    if (!rootPath) {
      this.previewImageProfile = null;
      this.publishImageOptimizationWarnings(null);
      return null;
    }
    try {
      const activeSourcePath = this.activeFilePath && isTypstDocumentPath(this.activeFilePath)
        ? this.activeFilePath
        : null;
      const profile = await invoke<PreviewImageProfile>("typst_preview_image_profile", {
        rootPath,
        activeSourcePath,
        activeSourceContents: activeSourcePath ? this.editorInstance.state.doc.toString() : null
      });
      this.previewImageProfile = profile;
      this.publishImageOptimizationWarnings(profile);
      return profile;
    } catch (error) {
      this.appendDeveloperLog({
        kind: "warning",
        source: "preview scheduler",
        message: `Could not inspect preview image dimensions: ${String(error)}`
      });
      return null;
    }
  }

  private updateImageHeavyPreviewWarning(profile: PreviewImageProfile | null): void {
    const button = document.getElementById("preview-image-warning-btn") as HTMLButtonElement | null;
    if (!button) return;
    if (!profile) {
      button.dataset.active = "false";
      button.classList.add("hidden");
      return;
    }
    const optimizationCandidates = this.recommendedImageOptimizationAssets(profile);
    const imageHeavy = optimizationCandidates.length > 0
      || profile.estimatedTotalDecodedBytes > MAX_RECOMMENDED_TOTAL_DECODED_PREVIEW_IMAGE_BYTES
      || profile.totalSourceBytes > MAX_RECOMMENDED_PREVIEW_IMAGE_SOURCE_BYTES
      || profile.uniqueImageCount >= MAX_RECOMMENDED_UNIQUE_PREVIEW_IMAGES;
    if (!imageHeavy) {
      button.dataset.active = "false";
      button.classList.add("hidden");
      return;
    }

    const renderMode = this.effectivePreviewRenderMode;
    const timing = renderMode === "on-type"
      ? "Live preview may update slowly while typing."
      : "Preview may take longer to update after each save.";
    const summary = `${timing} ${profile.uniqueImageCount.toLocaleString()} raster image${profile.uniqueImageCount === 1 ? "" : "s"} may use about ${formatFileSize(profile.estimatedTotalDecodedBytes)} when decoded. Click for details.`;
    button.dataset.active = "true";
    button.title = summary;
    button.setAttribute("aria-label", `Image-heavy document warning. ${summary}`);
    button.classList.remove("hidden");
  }

  private updatePreviewContentModeControl(compiling?: boolean): void {
    if (compiling !== undefined) this.previewContentModeCompiling = compiling;
    const toggle = document.getElementById("preview-content-mode-toggle") as HTMLButtonElement | null;
    if (!toggle) return;
    const draftActive = this.previewContentMode === "draft";
    toggle.dataset.compiling = String(this.previewContentModeCompiling);
    toggle.classList.toggle("active", draftActive);
    toggle.setAttribute("aria-checked", String(draftActive));
    const label = toggle.querySelector<HTMLElement>(".preview-content-mode-label");
    if (label) label.textContent = draftActive ? "Draft" : "Normal";
    toggle.setAttribute(
      "aria-label",
      draftActive
        ? "Draft Preview active; switch to Normal Preview"
        : "Normal Preview active; switch to Draft Preview"
    );
    const presentedMismatch = this.presentedPreviewContentMode !== this.previewContentMode;
    toggle.title = this.previewContentModeCompiling || presentedMismatch
      ? `Preparing ${this.previewContentMode === "draft" ? "Draft" : "Normal"} Preview. The last successful ${this.presentedPreviewContentMode === "draft" ? "Draft" : "Normal"} Preview remains visible.`
      : `${this.previewContentMode === "draft"
          ? `Draft Preview is active. Click to return to Normal Preview. ${this.draftImageAssets.size} image asset(s) use ratio-preserving placeholders; ${this.draftImageDiagnostics.length} call(s) remain unchanged.`
          : "Normal Preview is active. Click to switch to Draft Preview."}`;
  }

  private async setPreviewContentMode(mode: PreviewContentMode): Promise<void> {
    if (!this.workspaceRootPath) return;
    if (mode === this.previewContentMode) {
      if (mode === "draft" && this.presentedPreviewContentMode === "draft") {
        await this.showDraftPreviewDetails();
      }
      return;
    }
    this.previewContentMode = mode;
    this.updatePreviewContentModeControl(true);
    await this.saveWorkspaceState();
    this.invalidatePreviewWork(`preview content mode changed to ${mode}`);
    await this.refreshActivePreviewRoot(true);
  }

  private async showDraftPreviewDetails(): Promise<void> {
    const assets = [...this.draftImageAssets.values()];
    const sourceBytes = assets.reduce((total, asset) => total + asset.sourceBytes, 0);
    const decodedBytes = assets.reduce((total, asset) => total + asset.estimatedDecodedBytes, 0);
    const unresolved = this.draftImageDiagnostics.slice(0, 5).map(diagnostic =>
      `${fileNameFromPath(diagnostic.sourcePath)}: ${diagnostic.reason}`
    );
    const unresolvedSummary = this.draftImageDiagnostics.length === 0
      ? "All statically detectable local image calls were replaced."
      : `${this.draftImageDiagnostics.length} image call(s) remain unchanged.\n\n${unresolved.join("\n")}${this.draftImageDiagnostics.length > unresolved.length ? `\n…and ${this.draftImageDiagnostics.length - unresolved.length} more.` : ""}`;
    await this.appDialogController.show({
      title: "Draft Preview",
      subtitle: `${assets.length.toLocaleString()} ratio-preserving placeholder${assets.length === 1 ? "" : "s"}`,
      description: `Draft Preview keeps each source image's intrinsic aspect ratio and preserves the document's image sizing, fitting, and placement arguments. Hover or keyboard-focus a placeholder in the preview to inspect the original image.\n\nThe replaced images total ${formatFileSize(sourceBytes)} on disk and approximately ${formatFileSize(decodedBytes)} when decoded.\n\n${unresolvedSummary}\n\nPDF export always uses the original images.`,
      actions: [{ id: "close", label: "Close", primary: true }],
      cancelAction: "close"
    });
  }

  private async showImageHeavyPreviewDetails(): Promise<void> {
    const profile = this.previewImageProfile;
    if (!profile) return;
    const optimizationCandidates = this.recommendedImageOptimizationAssets(profile);
    const visibleItems = profile.images.slice(0, 3).map(image =>
      `${fileNameFromPath(image.path)} (${image.width.toLocaleString()} × ${image.height.toLocaleString()}, about ${formatFileSize(image.estimatedDecodedBytes)} decoded from ${formatFileSize(image.sourceBytes)})`
    );
    const additional = profile.images.length > visibleItems.length
      ? ` and ${profile.images.length - visibleItems.length} more`
      : "";
    const renderMode = this.effectivePreviewRenderMode;
    const actions = [{ id: "close", label: "Close", primary: false }];
    if (optimizationCandidates.length > 0) {
      actions.push({ id: "view-images", label: "View Images", primary: false });
    }
    if (renderMode === "on-type") {
      actions.push({ id: "switch-on-save", label: "Use On Save", primary: true });
    }
    // AppDialogController supports at most three actions. In Normal + On Type
    // mode, prefer the less disruptive render-on-save recommendation; the
    // toolbar toggle remains available for switching to Draft Preview.
    if (this.previewContentMode !== "draft" && actions.length < 3) {
      actions.push({ id: "use-draft", label: "Use Draft Preview", primary: renderMode !== "on-type" });
    }
    const action = await this.appDialogController.show({
      title: "Image-heavy Document",
      subtitle: `${profile.uniqueImageCount} raster image${profile.uniqueImageCount === 1 ? "" : "s"} · ${formatFileSize(profile.estimatedTotalDecodedBytes)} estimated decoded`,
      description: `This preview references ${profile.referenceCount.toLocaleString()} supported raster image${profile.referenceCount === 1 ? "" : "s"} across ${profile.uniqueImageCount.toLocaleString()} unique file${profile.uniqueImageCount === 1 ? "" : "s"}, totaling ${formatFileSize(profile.totalSourceBytes)} on disk.\n\nLargest assets: ${visibleItems.join("; ")}${additional}.\n\n${renderMode === "on-type" ? "Repeated on-type compilation may make editing less responsive." : "The preview may take longer to update after each save."} Compilation will continue normally, and Typsastra will not modify the images.`,
      actions,
      cancelAction: "close"
    });
    if (action === "view-images") {
      this.sidebarController.setTool("images");
      if (optimizationCandidates[0]) {
        await this.imageToolsController.selectImage(optimizationCandidates[0].path);
      }
      return;
    }
    if (action === "use-draft") {
      await this.setPreviewContentMode("draft");
      return;
    }
    if (action !== "switch-on-save") return;
    await this.setPreviewRenderMode("on-save");
    this.updateImageHeavyPreviewWarning(profile);
    this.appendDeveloperLog({
      kind: "info",
      source: "preview scheduler",
      message: `Switched to render on save for an image-heavy document: unique=${profile.uniqueImageCount}; references=${profile.referenceCount}; source=${formatFileSize(profile.totalSourceBytes)}; decoded=${formatFileSize(profile.estimatedTotalDecodedBytes)}.`
    });
  }

  private async showReleaseSummaryIfNeeded(): Promise<void> {
    const version = await getVersion().catch(() => null);
    if (!version) return;
    const seenKey = `${RELEASE_SUMMARY_SEEN_KEY_PREFIX}:${version}`;
    let lastSeenVersion: string | null = null;
    try {
      lastSeenVersion = window.localStorage.getItem(seenKey) === "1" ? version : null;
    } catch {
      // A restricted WebView storage policy should not prevent application startup.
    }
    if (!shouldShowReleaseSummary(version, lastSeenVersion)) return;
    const summary = releaseSummaryForVersion(version);
    const overlay = document.getElementById("release-summary-overlay");
    const title = document.getElementById("release-summary-title");
    const subtitle = document.getElementById("release-summary-subtitle");
    const highlights = document.getElementById("release-summary-highlights");
    const closeButton = document.getElementById("release-summary-close") as HTMLButtonElement | null;
    const doneButton = document.getElementById("release-summary-done") as HTMLButtonElement | null;
    const detailsButton = document.getElementById("release-summary-details") as HTMLButtonElement | null;
    if (!summary || !overlay || !title || !subtitle || !highlights || !closeButton || !doneButton || !detailsButton) return;

    title.textContent = `What's new in Typsastra ${summary.version}`;
    subtitle.textContent = summary.title;
    highlights.replaceChildren(...summary.highlights.map(highlight => {
      const item = document.createElement("li");
      item.textContent = highlight;
      return item;
    }));
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const close = () => {
      overlay.classList.add("hidden");
      document.removeEventListener("keydown", onKeydown);
      previouslyFocused?.focus();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !overlay.classList.contains("hidden")) close();
    };
    closeButton.onclick = close;
    doneButton.onclick = close;
    detailsButton.onclick = () => {
      void openUrl(summary.detailsUrl);
      close();
    };
    overlay.onmousedown = event => {
      if (event.target === overlay) close();
    };
    document.addEventListener("keydown", onKeydown);
    overlay.classList.remove("hidden");
    try {
      window.localStorage.setItem(seenKey, "1");
    } catch {
      // The summary may repeat when persistent WebView storage is unavailable.
    }
    doneButton.focus();
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
    this.acceptedTypographyScales.set(
      filePathKey(path),
      this.typographyController.fromText(tab.content)?.fonts.map(font => ({ ...font })) ?? []
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
        this.publishImageOptimizationWarnings();
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
    this.publishImageOptimizationWarnings();
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
    this.pdfPreviewSourceMapRootPath = null;
    this.pdfPreviewSourceMapTaskId = null;
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
        this.queuedPdfPreviewContents ??= contents;
        this.queuedPdfPreviewForced = true;
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

  private async saveActiveFile(intent: SaveIntent = "manual") {
    if (this.saveInProgress) {
      const inProgressIntent = this.saveInProgressIntent;
      await this.saveInProgress;
      if (intent === "manual" && inProgressIntent === "automatic") {
        await this.saveActiveFile("manual");
      }
      return;
    }
    this.flushEditorContentMutation();
    const operation = this.performSaveActiveFile(intent);
    this.saveInProgress = operation;
    this.saveInProgressIntent = intent;
    try {
      await operation;
    } finally {
      if (this.saveInProgress === operation) {
        this.saveInProgress = null;
        this.saveInProgressIntent = null;
      }
    }
  }

  private configureAutoSave(enabled: boolean, intervalSeconds: number): void {
    if (this.autoSaveTimer !== null) window.clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = null;
    if (!enabled) return;
    this.autoSaveTimer = window.setTimeout(() => {
      this.autoSaveTimer = null;
      void this.runAutoSaveCycle().finally(() => {
        const { autoSave, autoSaveIntervalSeconds } = this.settingsController.value.editor;
        this.configureAutoSave(autoSave, autoSaveIntervalSeconds);
      });
    }, intervalSeconds * 1000);
  }

  private async runAutoSaveCycle(): Promise<void> {
    if (this.saveInProgress || !this.workspaceRootPath) return;
    this.flushEditorContentMutation();
    const dirtyTabs = this.openTabs.filter(tab =>
      tab.contentLoaded
      && tab.isDirty
      && this.isInternallySupportedPath(tab.path)
      && !isBinaryImagePath(tab.path)
      && fileExtension(tab.path) !== "pdf"
    );
    if (dirtyTabs.length === 0) return;

    const operation = this.performAutoSave(dirtyTabs);
    this.saveInProgress = operation;
    this.saveInProgressIntent = "automatic";
    try {
      await operation;
    } finally {
      if (this.saveInProgress === operation) {
        this.saveInProgress = null;
        this.saveInProgressIntent = null;
      }
    }
  }

  private async performAutoSave(tabs: EditorTab[]): Promise<void> {
    let savedCount = 0;
    try {
      for (const tab of tabs) {
        const content = tab.content;
        await invoke("save_workspace_file", { path: tab.path, contents: content });
        if (tab.content !== content) continue;
        tab.savedContent = content;
        tab.isDirty = false;
        this.externalConflictPaths.delete(filePathKey(tab.path));
        savedCount += 1;
      }
    } catch (error) {
      const message = `Auto-save failed: ${String(error)}`;
      console.error(message);
      this.setLspStatus({ kind: "error", message });
    } finally {
      if (savedCount > 0) {
        this.renderEditorTabs();
        this.appendDeveloperLog({
          kind: "info",
          source: "workspace",
          message: `Auto-saved ${savedCount} file${savedCount === 1 ? "" : "s"} without requesting preview compilation.`
        });
      }
    }
  }

  private async saveActiveFileAs(): Promise<void> {
    if (!this.activeFilePath || !this.isInternallySupportedPath(this.activeFilePath) || isBinaryImagePath(this.activeFilePath) || fileExtension(this.activeFilePath) === "pdf") {
      return;
    }

    const sourceWasPinnedMain = this.isPinnedMainFile(this.activeFilePath);
    const extension = fileExtension(this.activeFilePath);
    const savePath = await save({
      defaultPath: this.activeFilePath,
      filters: extension ? [{ name: `${extension.toUpperCase()} File`, extensions: [extension] }] : undefined
    });
    if (typeof savePath !== "string") return;
    if (filePathKey(savePath) === filePathKey(this.activeFilePath)) {
      await this.saveActiveFile();
      return;
    }

    try {
      if (this.activeMode === "CODE" && this.settingsController.value.editor.formatOnSave) {
        await this.formatActiveDocument({ silent: true });
        this.removeTrailingSpaces();
      }
      const content = this.activeMode === "WYSIWYM"
        ? this.mapWysiwymToMarkup()
        : this.editorInstance.state.doc.toString();
      await invoke("save_workspace_file", { path: savePath, contents: content });
      if (this.workspaceRootPath) await this.explorer.loadWorkspace(this.workspaceRootPath);
      await this.loadFile(savePath);
      if (sourceWasPinnedMain && isTypstDocumentPath(savePath)) {
        await this.setPinnedMainFile(savePath);
      }
      this.setLspStatus({ kind: "preview-ready", message: "File saved as a new document" });
    } catch (error) {
      const failure = `Save As failed: ${String(error)}`;
      console.error(failure);
      this.setLspStatus({ kind: "error", message: failure });
      alert(failure);
    }
  }

  private deferWordWrapForResize(): void {
    const editor = this.editorInstance;
    if (!editor || !this.settingsController.value.editor.wordWrap || this.wordWrapDeferredForResize) return;
    this.wordWrapDeferredForResize = true;
    editor.dispatch({ effects: wrapCompartment.reconfigure([]) });
  }

  private beginHorizontalPaneResize(): void {
    this.horizontalPaneResizeActive = true;
    this.previewFrame.suspendResizeLayout();
    this.deferWordWrapForResize();
  }

  private endHorizontalPaneResize(): void {
    this.horizontalPaneResizeActive = false;
    for (const resolve of this.horizontalPaneResizeWaiters) resolve();
    this.horizontalPaneResizeWaiters.clear();
    this.restoreWordWrapAfterResize();
    this.previewFrame.resumeResizeLayout();
  }

  private async recoverAfterSystemResume(suspendedMs: number): Promise<void> {
    if (this.systemResumeRecoveryActive) {
      this.appendDeveloperLog({
        kind: "log",
        source: "workspace",
        message: "Ignored a duplicate system-resume recovery while the workspace was already being restored."
      });
      return;
    }
    this.systemResumeRecoveryActive = true;
    const showRecoveryCover = !!this.workspaceRootPath && !!this.activeFilePath;
    if (showRecoveryCover) document.body.classList.add("typsastra-resume-recovering");

    const interruptedResize = this.layoutController.recoverInterruptedResize();
    if (this.horizontalPaneResizeActive) this.endHorizontalPaneResize();

    this.cancelManualForwardSync();
    this.sourceMapSessionController.reset();

    try {
      // WebView2 can discard font and layout resources while Windows is
      // suspended. Startup and workspace opening wait for these fonts before
      // exposing the editor, so resume must restore the same invariant.
      await this.editorFontManager.ready();
      if (this.editorInstance) {
        this.editorFontManager.updateDocument(this.editorInstance.state.doc.toString());
      }

      this.previewFrame.resumeResizeLayout();
      this.previewFrame.syncTheme();
      if (this.workspaceRootPath) this.sidebarController.applyVisibility();
      this.layoutController.reconcileDockedPaneWidths();

      // The first post-resume frame can still use the pre-suspend display
      // metrics. Measure once after two paints, then again after WebView2 has
      // delivered delayed monitor/DPI resize notifications.
      await this.waitForResumeLayoutFrames();
      this.remeasureWorkspaceAfterResume("system resume");
      await new Promise<void>(resolve => window.setTimeout(resolve, 160));
      await this.waitForResumeLayoutFrames();
      this.remeasureWorkspaceAfterResume("system resume settling");

      if (
        this.lspReady
        && this.previewFrame.currentUrl
        && this.pdfPreviewGeneration > 0
        && !this.pdfPreviewRunning
      ) {
        this.schedulePdfSourceMapWarmup(this.pdfPreviewGeneration);
      }
      this.appendDeveloperLog({
        kind: "info",
        source: "workspace",
        message: `Recovered after system resume (${Math.round(suspendedMs / 1000)}s suspended); interruptedResize=${interruptedResize}.`
      });
    } catch (error) {
      this.appendDeveloperLog({
        kind: "error",
        source: "workspace",
        message: `System-resume workspace recovery failed: ${String(error)}`
      });
    } finally {
      document.body.classList.remove("typsastra-resume-recovering");
      this.systemResumeRecoveryActive = false;
    }
  }

  private waitForResumeLayoutFrames(): Promise<void> {
    return new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  private remeasureWorkspaceAfterResume(reason: string): void {
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
  }

  private waitForHorizontalPaneResizeEnd(): Promise<void> {
    if (!this.horizontalPaneResizeActive) return Promise.resolve();
    return new Promise(resolve => this.horizontalPaneResizeWaiters.add(resolve));
  }

  private restoreWordWrapAfterResize(): void {
    if (!this.wordWrapDeferredForResize) return;
    this.wordWrapDeferredForResize = false;
    const editor = this.editorInstance;
    if (!editor) return;
    editor.dispatch({
      effects: wrapCompartment.reconfigure(
        this.settingsController.value.editor.wordWrap ? EditorView.lineWrapping : []
      )
    });
    this.editorController.refreshLayout("resize completed");
  }

  private async performSaveActiveFile(intent: SaveIntent): Promise<void> {
    if (!this.activeFilePath || !this.isInternallySupportedPath(this.activeFilePath) || isBinaryImagePath(this.activeFilePath) || fileExtension(this.activeFilePath) === "pdf") {
      return;
    }

    try {
      const saveDiagnosticId = ++this.saveMemoryDiagnosticGeneration;
      await this.performanceController.logMemoryDiagnostics(`save ${saveDiagnosticId}: before write`);
      if (intent === "manual" && this.activeMode === "CODE" && this.settingsController.value.editor.formatOnSave) {
        await this.formatActiveDocument({ silent: true });
        this.removeTrailingSpaces();
      }

      const content = this.activeMode === "WYSIWYM"
        ? this.mapWysiwymToMarkup()
        : this.editorInstance.state.doc.toString();

      await invoke("save_workspace_file", {
        path: this.activeFilePath,
        contents: content
      });
      await this.performanceController.logMemoryDiagnostics(`save ${saveDiagnosticId}: after workspace write`);

      if (intent === "manual" && this.lspReady && this.lspClient) {
        await this.flushPendingLspSync();
        const lspRes = await this.getLspUriAndContent(this.activeFilePath, content);
        if (lspRes) {
          const { uri: lspUri, content: lspContent } = lspRes;
          await this.lspClient.notifyTextSave(lspUri, lspContent);
        }
      }
      await this.performanceController.logMemoryDiagnostics(`save ${saveDiagnosticId}: after LSP save notification`);

      const activeTab = this.getActiveTab();
      if (activeTab) {
        activeTab.content = content;
        activeTab.savedContent = content;
        activeTab.isDirty = false;
        this.externalConflictPaths.delete(filePathKey(activeTab.path));
        this.renderEditorTabs();
      }
      this.setLspStatus({ kind: "preview-ready", message: "File saved" });
      if (
        intent === "manual"
        && participatesInPreviewCompilation(this.activeFilePath, this.pinnedMainFilePath, this.previewImported)
        && !this.previewDisabled
      ) {
        void this.renderPdfPreview(content);
      }

    } catch (error) {
      const message = `Save failed: ${String(error)}`;
      console.error(message);
      this.setLspStatus({ kind: "error", message });
      alert(message);
    }
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
        await this.reloadWorkspaceFonts();
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
    const typographyDocumentKey = filePathKey(this.activeFilePath);
    const previousAcceptedScale = this.acceptedTypographyScales.get(typographyDocumentKey) ?? [];
    this.acceptedTypographyScales.set(typographyDocumentKey, config.fonts.map(font => ({ ...font })));
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
          ? await this.updateWorkspaceTypographyFont(config)
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
          await this.reloadTemplateTypographyContext(config);
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

      await this.reloadTemplateTypographyContext(config);
      this.setLspStatus({ kind: "preview-ready", message: "Typography applied to template" });
      this.editorInstance.focus();
      return true;
    } catch (error) {
      this.acceptedTypographyScales.set(typographyDocumentKey, previousAcceptedScale);
      this.appendLspLog({
        kind: "error",
        source: "typography",
        message: `Failed to apply template typography: ${String(error)}`
      });
      await message(String(error), { title: "Unable to apply typography", kind: "error" });
      return false;
    }
  }

  private async prepareWorkspaceTypographyFont(config: DocumentTypography): Promise<boolean> {
    if (!this.workspaceRootPath) return false;
    const scaled = config.fonts.filter(font => Math.abs(font.scale - 1) > 0.0001);
    const status = await this.typographyController.scaledFontSetStatus(config);
    if (!status.updateRequired) return false;
    this.typographyFontUpdateInProgress = true;
    if (scaled.length === 0) {
      return invoke<boolean>("clear_scaled_workspace_fonts", { workspaceRootPath: this.workspaceRootPath });
    }
    let changed = false;
    if (status.generationRequired) {
      this.previewFrame.setLoading(`Scaling ${scaled.length} document font${scaled.length === 1 ? "" : "s"}… The result will be stored in Typsastra's global cache.`);
    }
    for (const font of scaled) {
      const result = await invoke<{ changed: boolean }>("prepare_scaled_workspace_font", {
        workspaceRootPath: this.workspaceRootPath,
        family: font.family,
        scale: font.scale
      });
      changed ||= result.changed;
    }
    const activationChanged = await invoke<boolean>("activate_scaled_workspace_fonts", {
      workspaceRootPath: this.workspaceRootPath,
      fonts: config.fonts
    });
    changed ||= activationChanged;
    return changed;
  }

  private async updateWorkspaceTypographyFont(config: DocumentTypography): Promise<boolean> {
    let changed = false;
    try {
      changed = await this.prepareWorkspaceTypographyFont(config);
      if (changed) await this.reloadWorkspaceFonts();
    } finally {
      this.typographyFontUpdateInProgress = false;
    }
    const hadDeferredPreview = this.deferredTypographyPreviewContents !== null;
    this.deferredTypographyPreviewContents = null;
    return changed || hadDeferredPreview;
  }

  private async reloadTemplateTypographyContext(config: DocumentTypography): Promise<void> {
    if (this.workspaceRootPath && this.pinnedMainFilePath) {
      try {
        await this.prepareWorkspaceTypographyFont(config);
      } finally {
        this.typographyFontUpdateInProgress = false;
        this.deferredTypographyPreviewContents = null;
      }
    }
    // A blocked large preview must remain stopped until its own confirmation
    // is accepted. Its eventual startup will read the updated template.
    if (this.blockedLargePreviewRoot) return;
    if (this.lspClient) {
      await this.restartTinymistSession("Reloading template typography...");
      await this.restoreActiveDocumentAfterTinymistRestart();
    } else {
      await this.refreshActivePreviewRoot(true);
    }
  }

  private async reloadWorkspaceFonts(): Promise<void> {
    if (!this.lspClient || !this.workspaceRootPath) return;
    await this.restartTinymistSession("Reloading project fonts...");
    const lspMainPath = this.previewStandalone
      ? this.previewRootPath
      : (this.previewMainPath ?? this.previewRootPath);
    await this.updatePinnedMain(lspMainPath, true);
    if (this.activeFilePath) {
      await this.recheckActiveDocumentAfterPin(this.editorInstance.state.doc.toString());
    }
    this.sourceMapSessionController.reset({ retry: false });
  }

  private async handlePrivateFontDirectoriesChanged(): Promise<void> {
    if (!this.workspaceRootPath || this.blockedLargePreviewRoot) return;
    if (this.lspClient) {
      await this.reloadWorkspaceFonts();
      return;
    }
    await this.refreshActivePreviewRoot(true);
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

  private async renderPdfPreview(contents: string, force = false): Promise<void> {
    if (this.previewDisabled) {
      this.appendDeveloperLog({ kind: "info", source: "preview scheduler", message: "Render skipped: preview is disabled." });
      return;
    }
    if (!activeFileCanRenderPreview(
      this.activeFilePath,
      this.pinnedMainFilePath,
      this.previewImported,
      this.previewDisabled
    )) {
      this.appendDeveloperLog({
        kind: "info",
        source: "preview scheduler",
        message: `Render skipped: ${this.activeFilePath ?? "no active file"} does not participate in the configured main preview.`
      });
      return;
    }
    if (!await this.ensureLargePreviewApproved(this.previewRootPath)) {
      this.appendDeveloperLog({
        kind: "info",
        source: "preview scheduler",
        message: `Render deferred until the large preview is approved: ${this.previewRootPath ?? "unknown root"}.`
      });
      return;
    }
    const imageProfile = await this.inspectPreviewImageProfile(this.previewRootPath);
    this.updateImageHeavyPreviewWarning(imageProfile);
    if (this.typographyFontUpdateInProgress) {
      this.deferredTypographyPreviewContents = contents;
      this.appendDeveloperLog({
        kind: "info",
        source: "preview scheduler",
        message: `Render deferred while typography fonts are updating: sourceUtf16=${contents.length}; forced=${force}.`
      });
      return;
    }
    if (!this.activeFilePath || !this.lspReady || !this.lspClient) {
      this.appendDeveloperLog({
        kind: "info",
        source: "preview scheduler",
        message: `Render skipped: active=${this.activeFilePath ?? "none"}; lspReady=${this.lspReady}; client=${!!this.lspClient}.`
      });
      return;
    }
    const reportRenderStatus = force || !this.previewFrame.currentUrl;
    if (force) {
      this.previewFrame.setLoading("Recompiling PDF preview...");
    }
    if (this.pdfPreviewRunning) {
      this.queuedPdfPreviewContents = contents;
      this.queuedPdfPreviewForced ||= force;
      this.appendDeveloperLog({
        kind: "info",
        source: "preview scheduler",
        message: `Render queued behind active generation ${this.pdfPreviewGeneration}: sourceUtf16=${contents.length}; forced=${this.queuedPdfPreviewForced}.`
      });
      return;
    }
    this.cancelManualForwardSync();
    this.pdfPreviewRunning = true;
    const compileStartedAt = performance.now();
    const generation = ++this.pdfPreviewGeneration;
    const generationActivePath = this.activeFilePath;
    const generationContentMode = this.previewContentMode;
    const preparationRevision = this.pdfPreparationRevision;
    let renderSucceeded = false;
    let preparedPreview: PreparedPdfPreview | null = null;
    await this.performanceController.logMemoryDiagnostics(`render ${generation}: before preparation`);
    this.appendDeveloperLog({
      kind: "info",
      source: "preview scheduler",
      message: `Render generation ${generation} started: refresh=${this.effectivePreviewRenderMode}; content=${generationContentMode}; active=${this.activeFilePath}; sourceUtf16=${contents.length}.`
    });
    if (reportRenderStatus) {
      this.setLspStatus({ kind: "syncing", message: "Compiling preview" });
    }
    if (!force && !this.previewFrame.currentUrl) {
      this.previewFrame.setLoading("Compiling PDF preview...");
    }
    try {
      this.ensurePreviewPreparationCurrent(preparationRevision);
      const draftPreparationStartedAt = performance.now();
      const useEditorOverlays = this.effectivePreviewRenderMode === "on-type" || force;
      preparedPreview = await this.preparePdfPreviewExportPath(
        contents,
        preparationRevision,
        generationContentMode,
        useEditorOverlays
      );
      if (!preparedPreview) throw new Error("No PDF preview root is available.");
      const previewPath = preparedPreview.path;
      this.performanceController.record({
        name: "preview.draft-prepare",
        milliseconds: performance.now() - draftPreparationStartedAt,
        detail: {
          contentMode: generationContentMode,
          replacedAssets: preparedPreview.draftAssets.size,
          unresolvedCalls: preparedPreview.draftDiagnostics.length,
          projectManifestCacheHits: preparedPreview.draftProjectCacheHits,
          overlayManifestCacheHits: preparedPreview.draftOverlayCacheHits,
          overlayPreparations: preparedPreview.draftOverlayPreparations,
          projectMs: Math.round(preparedPreview.projectPreparationMs * 10) / 10,
          overlayMs: Math.round(preparedPreview.overlayPreparationMs * 10) / 10,
          backendSetupMs: Math.round(preparedPreview.backendTimings.setupMs * 10) / 10,
          backendCleanupMs: Math.round(preparedPreview.backendTimings.cleanupMs * 10) / 10,
          backendDiscoveryMs: Math.round(preparedPreview.backendTimings.discoveryMs * 10) / 10,
          backendTypMs: Math.round(preparedPreview.backendTimings.typProcessingMs * 10) / 10,
          backendAssetMs: Math.round(preparedPreview.backendTimings.assetSyncMs * 10) / 10,
          discoveredFiles: preparedPreview.backendTimings.discoveredFiles,
          typFiles: preparedPreview.backendTimings.typFiles,
          assetFiles: preparedPreview.backendTimings.assetFiles
        }
      });
      this.ensurePreviewPreparationCurrent(preparationRevision);
      this.appendDeveloperLog({ kind: "info", source: "preview scheduler", message: `Render generation ${generation}: preview root prepared at ${previewPath}.` });
      const preparedPaths = [...new Set([
        previewPath,
        ...preparedPreview.changedPaths,
        ...[...this.pdfPreviewGeneratedFiles.values()].map(file => file.generatedPath)
      ].map(nativeFilePath))];
      if (preparedPaths.length > 0) {
        const closedPreparedDocuments = await this.closePreparedPreviewDocuments();
        this.ensurePreviewPreparationCurrent(preparationRevision);
        await this.lspClient.notifyWorkspaceFilesChanged(
          preparedPaths.map(path => ({ uri: filePathToUri(path), type: 2 as const }))
        );
        this.ensurePreviewPreparationCurrent(preparationRevision);
        this.appendDeveloperLog({
          kind: "info",
          source: "preview scheduler",
          message: `Render generation ${generation}: invalidated ${preparedPaths.length} disk-backed mirror file(s) and closed ${closedPreparedDocuments} legacy mirror document(s) before export.`
        });
      }
      const synchronizedPreparedDocuments = await this.openPreparedPreviewDocumentsForExport(preparedPaths);
      // Register the configured private output before awaiting the RPC because
      // Tinymist can create it before the workspace watcher receives the
      // command result. Do not reproduce the render mirror's relative path
      // beneath the preview directory.
      const cacheRoot = this.getCacheRootPath();
      if (!cacheRoot) throw new Error("No PDF preview cache is available.");
      const previewPdfName = fileNameFromPath(previewPath).replace(/\.typ$/i, ".pdf");
      const anticipatedPdfPath = `${cacheRoot}/preview/${previewPdfName}`;
      const anticipatedPdfPathKey = filePathKey(anticipatedPdfPath);
      this.managedPreviewPdfPathKeys.add(anticipatedPdfPathKey);
      let pdfPath: string;
      try {
        this.ensurePreviewPreparationCurrent(preparationRevision);
        // Tinymist's watched-file invalidation can complete after its
        // notification handler returns. Keep the exact prepared revision open
        // only for this RPC so export cannot observe the previous disk cache.
        pdfPath = await this.lspClient.exportPdfToFile(previewPath);
      } finally {
        const closedPreparedDocuments = await this.closePreparedPreviewDocuments();
        this.appendDeveloperLog({
          kind: "info",
          source: "preview scheduler",
          message: `Render generation ${generation}: released ${closedPreparedDocuments}/${synchronizedPreparedDocuments} transient mirror document(s) after export.`
        });
      }
      const actualPdfPathKey = filePathKey(pdfPath);
      this.managedPreviewPdfPathKeys.add(actualPdfPathKey);
      if (actualPdfPathKey !== anticipatedPdfPathKey) {
        // Keep the anticipated path through delayed watcher delivery, but do
        // not permanently reserve a project PDF that Tinymist did not write.
        window.setTimeout(() => {
          if (filePathKey(this.lastPdfPath) !== anticipatedPdfPathKey) {
            this.managedPreviewPdfPathKeys.delete(anticipatedPdfPathKey);
          }
        }, 60_000);
      }
      this.ensurePreviewPreparationCurrent(preparationRevision);
      this.appendDeveloperLog({ kind: "info", source: "preview scheduler", message: `Render generation ${generation}: Tinymist PDF export complete.` });
      // Export is native and may finish while the user is dragging a pane.
      // Do not install a new PDF, query process memory, allocate canvases, or
      // start the hidden source-map preview behind the resize placeholder.
      // One completed generation resumes after pointer release.
      await this.waitForHorizontalPaneResizeEnd();
      this.ensurePreviewPreparationCurrent(preparationRevision);
      await this.performanceController.logMemoryDiagnostics(
        `render ${generation}: after Tinymist export`,
        { transport: "binary-file" }
      );
      this.performanceController.record({
        name: "preview.compile",
        milliseconds: performance.now() - compileStartedAt,
        detail: { sourceUtf16: contents.length }
      });
      if (
        this.queuedPdfPreviewContents !== null
        && (this.queuedPdfPreviewForced || this.queuedPdfPreviewContents !== contents)
      ) {
        this.appendDeveloperLog({
          kind: "info",
          source: "preview scheduler",
          message: `Render generation ${generation} discarded: a newer queued request exists (queuedUtf16=${this.queuedPdfPreviewContents.length}; forced=${this.queuedPdfPreviewForced}).`
        });
        return;
      }
      if (generation !== this.pdfPreviewGeneration) {
        this.appendDeveloperLog({
          kind: "info",
          source: "preview scheduler",
          message: `Render generation ${generation} discarded: current generation is ${this.pdfPreviewGeneration}.`
        });
        return;
      }
      const sourceMapTaskId = previewSessionIdentity(
        previewPath,
        previewRefreshStyle(this.effectivePreviewRenderMode)
      ).taskId;
      // PreviewSyncController reconciles source-map tasks lazily during warm-up.
      // Never let optional cursor-sync lifecycle work block PDF presentation.
      this.pdfPreviewSourceMapRootPath = previewPath;
      this.pdfPreviewSourceMapTaskId = sourceMapTaskId;
      const stagedPdfPath = await invoke<string>("stage_pdf_preview_generation", {
        path: pdfPath,
        generation
      });
      this.managedPreviewPdfPathKeys.add(filePathKey(stagedPdfPath));
      this.lastPdfPath = stagedPdfPath;
      await this.loadPdfPath(
        stagedPdfPath,
        previewPath,
        this.previewSessionKey ?? previewPath,
        "live",
        true
      );
      this.presentedPreviewContentMode = generationContentMode;
      this.draftImageAssets = generationContentMode === "draft"
        ? preparedPreview.draftAssets
        : new Map();
      this.draftImageDiagnostics = generationContentMode === "draft"
        ? preparedPreview.draftDiagnostics
        : [];
      this.draftAssetRootPath = generationContentMode === "draft"
        ? this.workspaceRootPath
        : null;
      this.draftThumbnailDocumentRootPath = generationContentMode === "draft"
        ? preparedPreview.documentRootPath
        : null;
      if (generationContentMode === "draft") {
        this.draftThumbnailGeneration = generation;
        await this.startDraftThumbnailQueue(generation);
      } else {
        this.draftThumbnailGeneration = 0;
        void invoke("cancel_draft_thumbnail_generation").catch(() => {});
      }
      this.updatePreviewContentModeControl(false);
      // Presentation is authoritative even when the previous PDF stayed
      // visible during compilation. In particular, clear a stale compile
      // failure status after a recovered generation succeeds.
      this.logConsoleController.clearLogsBySource(["compiler", "package compatibility"]);
      this.setLspStatus({ kind: "preview-ready", message: "Preview ready" });
      this.appendDeveloperLog({ kind: "info", source: "preview scheduler", message: `Render generation ${generation}: PDF presentation complete.` });
      renderSucceeded = true;
      this.lastFailedPreviewContents = null;
      this.lastPreviewRecoveryRequestedContents = null;
      this.tinymistPreviewRecoveryAttempts = 0;
      this.schedulePdfSourceMapWarmup(generation);
      await this.performanceController.logMemoryDiagnostics(`render ${generation}: after PDF presentation`);
      window.setTimeout(() => {
        void this.performanceController.logMemoryDiagnostics(`render ${generation}: settled after page rendering`);
      }, 1000);
      if (this.pdfPreviewFailureAt !== null) {
        this.performanceController.record({
          name: "preview.recovery",
          milliseconds: performance.now() - this.pdfPreviewFailureAt
        });
        this.pdfPreviewFailureAt = null;
      }
      const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
      if (typeof memory?.usedJSHeapSize === "number") {
        this.performanceController.record({ name: "memory.heap", bytes: memory.usedJSHeapSize });
      }
      import("@tauri-apps/api/event").then(({ emit }) => {
        emit("pdf-update", {
          // Tinymist's stable output has already been renamed to an immutable
          // generation. The undocked viewer must open the same generation as
          // the docked viewer rather than the now-vacant export destination.
          path: stagedPdfPath,
          identity: previewPath,
          sessionKey: this.previewSessionKey ?? previewPath,
          surface: "live",
          contentMode: generationContentMode,
          draftAssets: generationContentMode === "draft" ? [...this.draftImageAssets.values()] : [],
          draftAssetRootPath: generationContentMode === "draft" ? this.draftAssetRootPath ?? undefined : undefined,
          draftThumbnailGeneration: generationContentMode === "draft" ? this.draftThumbnailGeneration : undefined
        } satisfies PdfUpdatePayload);
      }).catch(err => console.error("Error emitting pdf-update", err));
    } catch (error) {
      if (this.typographyFontUpdateInProgress) {
        this.appendDeveloperLog({
          kind: "info",
          source: "preview scheduler",
          message: `Render generation ${generation} interrupted for typography font replacement.`
        });
        return;
      }
      if (
        error instanceof PreviewPreparationInterrupted
        || (
          this.effectivePreviewRenderMode === "on-type"
          && preparationRevision !== this.pdfPreparationRevision
        )
      ) {
        this.appendDeveloperLog({
          kind: "info",
          source: "preview scheduler",
          message: `Render generation ${generation} interrupted by editor input; waiting for the next debounce.`
        });
        return;
      }
      if (generation !== this.pdfPreviewGeneration) {
        this.appendDeveloperLog({
          kind: "warning",
          source: "preview scheduler",
          message: `Render generation ${generation} failed after becoming stale: ${String(error)}`
        });
        return;
      }
      if (
        isTinymistStoppedRequestError(error)
        && await this.recoverTinymistPreviewAfterUnexpectedStop(contents, generation)
      ) {
        return;
      }
      console.error("PDF Preview compilation failed:", JSON.stringify(error, null, 2));
      const failure = parsePreviewCompilerFailure(error);
      const packageHint = await this.previewPackageFailureHint(failure, preparedPreview);
      const displayedFailureMessage = failure.location !== null
        && this.isRenderCachePath(failure.location.filePath)
        ? relocatePreviewCompilerFailureMessage(
            failure,
            this.mapToOriginalPath(failure.location.filePath)
          )
        : failure.message;
      const failureMessage = packageHint
        ? `${displayedFailureMessage}\n\nPackage compatibility hint\n${packageHint.message}`
        : displayedFailureMessage;
      this.lastFailedPreviewContents = contents;
      this.lastPreviewRecoveryRequestedContents = null;
      // Keep the last successful PDF mounted, but make an actual compiler
      // failure visible until a later generation presents successfully.
      this.previewFrame.setError("Preview Render Failed", failureMessage);
      this.publishPreviewCompilerFailure(failure, packageHint);
      this.updatePreviewContentModeControl(false);
      this.setLspStatus({ kind: "preview-error", message: "PDF compile failed" });
      this.pdfPreviewFailureAt ??= performance.now();
    } finally {
      this.pdfPreviewRunning = false;
      let queued = this.queuedPdfPreviewContents;
      const queuedForced = this.queuedPdfPreviewForced;
      this.queuedPdfPreviewContents = null;
      this.queuedPdfPreviewForced = false;
      if (
        this.effectivePreviewRenderMode === "on-type"
        && generationActivePath
        && filePathKey(this.activeFilePath ?? "") === filePathKey(generationActivePath)
        && activeFileCanRenderPreview(
          this.activeFilePath,
          this.pinnedMainFilePath,
          this.previewImported,
          this.previewDisabled
        )
      ) {
        const latestContents = this.editorInstance.state.doc.toString();
        if (latestContents !== contents) {
          // Editor input can invalidate an export before its debounced render
          // request reaches the serialized queue. Recover the latest settled
          // snapshot here so correcting a failed compile always gets another
          // compilation opportunity.
          queued = latestContents;
        }
      }
      this.appendDeveloperLog({
        kind: "info",
        source: "preview scheduler",
        message: `Render generation ${generation} released: succeeded=${renderSucceeded}; queued=${queued !== null}; queuedChanged=${queued !== null && queued !== contents}; queuedForced=${queuedForced}.`
      });
      if (queued !== null && (queuedForced || queued !== contents || !renderSucceeded)) {
        void this.renderPdfPreview(queued, queuedForced);
      }
      this.updateManualForwardSyncAction();
    }
  }

  private recompilePreviewManually(): void {
    if (!this.activeFilePath?.toLowerCase().endsWith(".typ")) return;
    if (this.pdfPreviewTimer) {
      window.clearTimeout(this.pdfPreviewTimer);
      this.pdfPreviewTimer = null;
    }
    const contents = this.editorInstance.state.doc.toString();
    this.appendDeveloperLog({
      kind: "info",
      source: "preview scheduler",
      message: `Manual preview recompile requested: active=${this.activeFilePath}; sourceUtf16=${contents.length}.`
    });
    void this.renderPdfPreview(contents, true);
  }

  private ensurePreviewPreparationCurrent(revision: number): void {
    if (
      this.effectivePreviewRenderMode === "on-type"
      && revision !== this.pdfPreparationRevision
    ) {
      throw new PreviewPreparationInterrupted();
    }
  }

  private async preparePdfPreviewExportPath(
    contents: string,
    preparationRevision = this.pdfPreparationRevision,
    contentMode = this.previewContentMode,
    useEditorOverlays = this.effectivePreviewRenderMode === "on-type"
  ): Promise<PreparedPdfPreview | null> {
    if (!this.activeFilePath) return null;
    const rootPath = this.previewStandalone ? (this.previewRootPath ?? this.activeFilePath) : (this.previewMainPath ?? this.previewRootPath ?? this.activeFilePath);
    if (!rootPath) return null;

    // Every live preview compiles from Typsastra's private render mirror.
    // Tinymist normally honors PREVIEW_OUTPUT_PATH, but older or incompatible
    // versions can fall back to writing beside their compilation root. Keeping
    // that root under .typsastra guarantees that even the fallback output
    // cannot create main.pdf or another generated file beside user sources.
    if (!this.workspaceRootPath) return null;
    const cacheRoot = this.getCacheRootPath();
    if (!cacheRoot) return null;
    this.pdfPreviewGeneratedFiles.clear();
    const originalRootPath = this.mapToOriginalPath(rootPath);
    const originalActivePath = this.mapToOriginalPath(this.activeFilePath);
    const options = {
      enableKhmerZws: this.settingsController.value.preview.khmerRenderPreparation,
      projectRoot: this.workspaceRootPath,
      entryFile: originalRootPath,
      cacheRoot,
      generateSourceMap: true,
      previewContentMode: contentMode
    };
    const projectPreparationStartedAt = performance.now();
    const result = await invoke<RenderPreparationResult>("prepare_render_project", { options });
    const projectPreparationMs = performance.now() - projectPreparationStartedAt;
    this.ensurePreviewPreparationCurrent(preparationRevision);
    const draftAssets = new Map(result.draftAssets.map(asset => [asset.id, asset]));
    const draftDiagnostics = [...result.draftDiagnostics];
    const draftReachableFileKeys = new Set(
      result.draftReachableFiles.map(path => filePathKey(this.mapToOriginalPath(path)))
    );
    let draftOverlayCacheHits = 0;
    let draftOverlayPreparations = 0;
    let overlayPreparationMs = 0;
    const tabsToOverlay = useEditorOverlays
      ? this.openTabs
        .filter(tab => tab.contentLoaded)
        .filter(tab => tab.path.toLowerCase().endsWith(".typ"))
        .filter(tab => this.workspaceRootPath && relativeFilePath(this.workspaceRootPath, this.mapToOriginalPath(tab.path)) !== null)
        .filter(tab => draftReachableFileKeys.has(filePathKey(this.mapToOriginalPath(tab.path))))
      : [];
    const overlaid = new Set<string>();
    for (const tab of tabsToOverlay) {
      const originalTabPath = this.mapToOriginalPath(tab.path);
      overlaid.add(filePathKey(originalTabPath));
      const sourceCode = filePathKey(originalTabPath) === filePathKey(originalActivePath)
        ? contents
        : tab.content;
      const overlayStartedAt = performance.now();
      const generated = await invoke<RenderPreparationFileResult>("prepare_render_file", {
        options,
        filePath: originalTabPath,
        sourceCode
      });
      overlayPreparationMs += performance.now() - overlayStartedAt;
      this.ensurePreviewPreparationCurrent(preparationRevision);
      this.pdfPreviewGeneratedFiles.set(filePathKey(originalTabPath), generated);
      draftOverlayPreparations += 1;
      if (generated.draftCacheHit) draftOverlayCacheHits += 1;
      for (const asset of generated.draftAssets) draftAssets.set(asset.id, asset);
      draftDiagnostics.push(...generated.draftDiagnostics);
    }
    if (
      useEditorOverlays
      && draftReachableFileKeys.has(filePathKey(originalActivePath))
      && !overlaid.has(filePathKey(originalActivePath))
    ) {
      const overlayStartedAt = performance.now();
      const activeGenerated = await invoke<RenderPreparationFileResult>("prepare_render_file", {
        options,
        filePath: originalActivePath,
        sourceCode: contents
      });
      overlayPreparationMs += performance.now() - overlayStartedAt;
      this.ensurePreviewPreparationCurrent(preparationRevision);
      this.pdfPreviewGeneratedFiles.set(filePathKey(originalActivePath), activeGenerated);
      draftOverlayPreparations += 1;
      if (activeGenerated.draftCacheHit) draftOverlayCacheHits += 1;
      for (const asset of activeGenerated.draftAssets) draftAssets.set(asset.id, asset);
      draftDiagnostics.push(...activeGenerated.draftDiagnostics);
    }
    this.appendDeveloperLog({
      kind: "info",
      source: "preview scheduler",
      message: contentMode === "draft"
        ? `Draft preparation replaced ${draftAssets.size} unique image asset(s); ${draftDiagnostics.length} image call(s) remained unchanged.`
        : "Normal preview preparation retained all document images."
    });
    return {
      path: result.generatedEntryFile,
      documentRootPath: originalRootPath,
      changedPaths: result.changedFiles,
      draftAssets: contentMode === "draft" ? draftAssets : new Map(),
      draftDiagnostics: contentMode === "draft" ? draftDiagnostics : [],
      draftProjectCacheHits: contentMode === "draft" ? result.draftCacheHits : 0,
      draftOverlayCacheHits: contentMode === "draft" ? draftOverlayCacheHits : 0,
      draftOverlayPreparations: contentMode === "draft" ? draftOverlayPreparations : 0,
      projectPreparationMs,
      overlayPreparationMs,
      backendTimings: result.timings,
      reachableSourcePaths: result.draftReachableFiles.map(path => this.mapToOriginalPath(path))
    };
  }

  private async loadPdfPath(
    path: string,
    identity: string,
    sessionKey = identity,
    surface: PreviewSurface = isTypstDocumentPath(identity) ? "live" : "pdf",
    deleteOnClose = false
  ): Promise<number> {
    const pathKey = filePathKey(path);
    if (this.blockedLargePdfPaths.has(pathKey)) return 0;
    const requestGeneration = ++this.pdfLoadRequestGeneration;
    if (PDF_TRANSPORT_MODE === "range") {
      const byteLength = await this.previewFrame.loadPdfPath(
        path,
        identity,
        sessionKey,
        surface,
        deleteOnClose
      );
      if (
        requestGeneration !== this.pdfLoadRequestGeneration
        || this.blockedLargePdfPaths.has(pathKey)
      ) return 0;
      if (this.previewFrame.currentUrl === identity) {
        this.lastPdfPath = path;
        this.lastPdfIdentity = identity;
        this.lastPdfSessionKey = sessionKey;
        this.lastPdfSurface = surface;
      }
      return byteLength;
    }
    await this.performanceController.logMemoryDiagnostics("PDF full-buffer before IPC read", {
      transport: PDF_TRANSPORT_MODE
    });
    const response = await invoke<ArrayBuffer | Uint8Array | number[]>("read_binary_file", { path });
    await this.performanceController.logMemoryDiagnostics("PDF full-buffer after IPC read", {
      transport: PDF_TRANSPORT_MODE
    });
    if (
      requestGeneration !== this.pdfLoadRequestGeneration
      || this.blockedLargePdfPaths.has(pathKey)
    ) return 0;
    const bytes = response instanceof Uint8Array
      ? response
      : response instanceof ArrayBuffer
        ? new Uint8Array(response)
        : new Uint8Array(response);
    const byteLength = bytes.byteLength;
    await this.previewFrame.loadPdfBytes(bytes, identity, sessionKey, surface);
    if (deleteOnClose) {
      await invoke("remove_preview_generation_file", { path }).catch(() => {});
    }
    if (this.previewFrame.currentUrl === identity) {
      this.lastPdfPath = path;
      this.lastPdfIdentity = identity;
      this.lastPdfSessionKey = sessionKey;
      this.lastPdfSurface = surface;
    }
    return byteLength;
  }

  private async loadDraftPreviewImage(id: string) {
    if (
      this.presentedPreviewContentMode !== "draft"
      || !/^[a-f0-9]{24}$/.test(id)
    ) return null;
    const asset = this.draftImageAssets.get(id);
    // Draft assets are canonicalized and checked against the workspace root by
    // the backend before they enter this generation-scoped manifest. Repeating
    // that check with frontend path strings rejects equivalent Windows paths
    // when one side uses an extended-length or 8.3 representation.
    if (!asset || !this.workspaceRootPath || this.draftThumbnailGeneration < 1) return null;
    const status = await invoke<DraftThumbnailStatus>("get_draft_thumbnail_status", {
      generation: this.draftThumbnailGeneration,
      workspaceRoot: this.workspaceRootPath,
      id
    }).catch(() => null);
    if (!status) return null;
    if (status.status === "failed") {
      return {
        status: "failed" as const,
        message: "Image preview could not be prepared."
      } as const;
    }
    if (status.status === "pending" || status.status === "generating") {
      return { status: status.status } as const;
    }
    if (!status.path || !status.mimeType) {
      return {
        status: "failed" as const,
        message: "The prepared image preview is unavailable."
      } as const;
    }
    const response = await invoke<ArrayBuffer | Uint8Array | number[]>("read_binary_file", {
      path: status.path
    });
    const bytes = response instanceof Uint8Array
      ? response
      : response instanceof ArrayBuffer
        ? new Uint8Array(response)
        : new Uint8Array(response);
    return {
      status: "ready" as const,
      bytes,
      mimeType: status.mimeType,
      filename: fileNameFromPath(asset.path),
      width: status.sourceWidth,
      height: status.sourceHeight,
      sourceBytes: status.sourceBytes
    };
  }

  private async startDraftThumbnailQueue(generation: number): Promise<void> {
    if (
      generation !== this.pdfPreviewGeneration
      || this.presentedPreviewContentMode !== "draft"
      || !this.workspaceRootPath
      || !this.draftThumbnailDocumentRootPath
      || this.draftImageAssets.size === 0
    ) return;
    const displayedPage = Math.max(1, this.previewPageStatus.currentPage || 1);
    const displayedPageAssetIds = await this.previewFrame.draftImageIdsForPage(displayedPage);
    if (
      generation !== this.pdfPreviewGeneration
      || this.presentedPreviewContentMode !== "draft"
    ) return;
    const summary = await invoke<DraftThumbnailQueueSummary>("start_draft_thumbnail_generation", {
      request: {
        generation,
        workspaceRoot: this.workspaceRootPath,
        documentRootPath: this.draftThumbnailDocumentRootPath,
        assets: [...this.draftImageAssets.values()],
        displayedPageAssetIds
      }
    }).catch(error => {
      this.appendDeveloperLog({
        kind: "warning",
        source: "draft thumbnails",
        message: `Could not start Draft thumbnail generation: ${String(error)}`
      });
      return null;
    });
    if (!summary || generation !== this.pdfPreviewGeneration) return;
    this.appendDeveloperLog({
      kind: "info",
      source: "draft thumbnails",
      message: `Draft thumbnail queue ${generation} started: ${summary.cacheHits} cache hit(s), ${summary.queued} queued, ${displayedPageAssetIds.length} image(s) on page ${displayedPage}.`
    });
  }

  private async closePreparedPreviewDocuments(): Promise<number> {
    if (!this.lspClient) return 0;
    const mirrorUris = [...this.openedDocumentUris].filter(uri =>
      this.isRenderCachePath(filePathFromUri(uri))
    );
    for (const uri of mirrorUris) {
      await this.lspClient.closeTextDocument(uri);
      this.openedDocumentUris.delete(uri);
    }
    return mirrorUris.length;
  }

  private async openPreparedPreviewDocumentsForExport(paths: string[]): Promise<number> {
    if (!this.lspClient) return 0;
    const preparedTextByPath = new Map(
      [...this.pdfPreviewGeneratedFiles.values()].map(file => [
        filePathKey(file.generatedPath),
        file.preparedText
      ])
    );
    const typPaths = [...new Map(
      paths
        .filter(path => isTypstDocumentPath(path))
        .map(path => [filePathKey(path), path])
    ).values()];
    let opened = 0;
    try {
      for (const path of typPaths) {
        const text = preparedTextByPath.get(filePathKey(path))
          ?? await invoke<string>("read_workspace_file", { path });
        const uri = filePathToUri(path);
        await this.lspClient.openTextDocument(uri, text, ++this.currentVersion);
        this.openedDocumentUris.add(uri);
        opened += 1;
      }
    } catch (error) {
      await this.closePreparedPreviewDocuments();
      throw error;
    }
    return opened;
  }

  private schedulePdfPreview(contents: string, delayMs = this.settingsController.value.preview.syncDebounceMs) {
    if (this.previewDisabled) {
      this.appendDeveloperLog({ kind: "info", source: "preview scheduler", message: "On-type schedule skipped: preview is disabled." });
      return;
    }
    if (!activeFileCanRenderPreview(
      this.activeFilePath,
      this.pinnedMainFilePath,
      this.previewImported,
      this.previewDisabled
    )) {
      this.appendDeveloperLog({
        kind: "info",
        source: "preview scheduler",
        message: `On-type schedule skipped: ${this.activeFilePath ?? "no active file"} does not participate in the configured main preview.`
      });
      return;
    }
    if (this.effectivePreviewRenderMode !== "on-type") {
      this.appendDeveloperLog({ kind: "info", source: "preview scheduler", message: `On-type schedule skipped: mode=${this.effectivePreviewRenderMode}.` });
      return;
    }
    if (this.pdfPreviewTimer) {
      window.clearTimeout(this.pdfPreviewTimer);
      this.appendDeveloperLog({ kind: "info", source: "preview scheduler", message: `On-type timer ${this.pdfPreviewScheduleGeneration} replaced by a newer edit.` });
    }
    const scheduleGeneration = ++this.pdfPreviewScheduleGeneration;
    const scheduledPath = this.activeFilePath;
    this.appendDeveloperLog({
      kind: "info",
      source: "preview scheduler",
      message: `On-type timer ${scheduleGeneration} scheduled: active=${scheduledPath ?? "none"}; sourceUtf16=${contents.length}; delay=${delayMs}ms.`
    });
    this.pdfPreviewTimer = window.setTimeout(() => {
      this.pdfPreviewTimer = null;
      if (
        this.activeFilePath
        && filePathKey(this.activeFilePath) === filePathKey(scheduledPath ?? "")
        && activeFileCanRenderPreview(
          this.activeFilePath,
          this.pinnedMainFilePath,
          this.previewImported,
          this.previewDisabled
        )
      ) {
        this.appendDeveloperLog({ kind: "info", source: "preview scheduler", message: `On-type timer ${scheduleGeneration} fired.` });
        void this.renderPdfPreview(contents);
      } else {
        this.appendDeveloperLog({
          kind: "info",
          source: "preview scheduler",
          message: `On-type timer ${scheduleGeneration} discarded: active path changed from ${scheduledPath ?? "none"} to ${this.activeFilePath ?? "none"}.`
        });
      }
    }, delayMs);
  }

  private handleContentMutation(rawText: string, previewDebounceElapsedMs = 0) {
    const canRenderPreview = activeFileCanRenderPreview(
      this.activeFilePath,
      this.pinnedMainFilePath,
      this.previewImported,
      this.previewDisabled
    );
    if (!this.isLoadingFile && canRenderPreview) {
      this.pdfPreparationRevision += 1;
      if (this.effectivePreviewRenderMode === "on-type") {
        void invoke("cancel_render_preparation").catch(() => {});
      }
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
      this.scheduleManualTypographyScaleCheck();
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
    this.pdfPreparationRevision += 1;
    this.pdfPreviewScheduleGeneration += 1;
    this.pdfPreviewGeneration += 1;
    if (this.pdfPreviewTimer !== null) window.clearTimeout(this.pdfPreviewTimer);
    this.pdfPreviewTimer = null;
    this.queuedPdfPreviewContents = null;
    this.queuedPdfPreviewForced = false;
    void invoke("cancel_render_preparation").catch(() => {});
    this.appendDeveloperLog({
      kind: "info",
      source: "preview scheduler",
      message: `Preview work invalidated: ${reason}.`
    });
  }

  private scheduleManualTypographyScaleCheck(): void {
    if (this.suppressTypographyScaleConfirmation || !this.activeFilePath) return;
    if (this.typographyScaleCheckTimer !== null) window.clearTimeout(this.typographyScaleCheckTimer);
    const generation = ++this.typographyScaleCheckGeneration;
    const delay = Math.max(600, this.settingsController.value.preview.syncDebounceMs);
    this.typographyScaleCheckTimer = window.setTimeout(() => {
      this.typographyScaleCheckTimer = null;
      if (generation !== this.typographyScaleCheckGeneration) return;
      void this.checkManualTypographyScaleChange();
    }, delay);
  }

  private async checkManualTypographyScaleChange(): Promise<void> {
    if (!this.activeFilePath || this.typographyScaleConfirmationOpen) {
      if (this.typographyScaleConfirmationOpen) this.scheduleManualTypographyScaleCheck();
      return;
    }
    const filePath = this.activeFilePath;
    const documentKey = filePathKey(filePath);
    const config = this.typographyController.fromText(this.editorInstance.state.doc.toString());
    if (!config) return;
    const previousFonts = this.acceptedTypographyScales.get(documentKey) ?? [];
    const signature = (fonts: DocumentScriptFont[]) => JSON.stringify(fonts.map(font => ({
      family: font.family,
      script: font.script,
      scale: Number(font.scale.toFixed(4)),
      defaultText: font.defaultText !== false,
    })));
    if (signature(previousFonts) === signature(config.fonts)) return;
    this.editorToolbarController.synchronizeDocumentTypography(config);
    if (!this.isPinnedMainFile(filePath)) {
      this.acceptedTypographyScales.set(documentKey, config.fonts.map(font => ({ ...font })));
      return;
    }
    if (!participatesInPreviewCompilation(this.activeFilePath, this.pinnedMainFilePath, this.previewImported)) {
      this.appendDeveloperLog({
        kind: "info",
        source: "preview scheduler",
        message: `On-type schedule skipped: ${this.activeFilePath ?? "no active file"} does not own the configured main preview.`
      });
      return;
    }
    const unsupportedInternalScale = await this.typographyController.unsupportedInternalScaleError(config);
    if (unsupportedInternalScale) {
      const errorKey = `${documentKey}\u0000${signature(config.fonts)}`;
      if (this.lastTypographyInternalScaleError !== errorKey) {
        this.lastTypographyInternalScaleError = errorKey;
        this.appendLspLog({
          kind: "error",
          source: "typography",
          message: unsupportedInternalScale.message,
        });
        await message(unsupportedInternalScale.message, {
          title: "Unsupported Built-in Font Scale",
          kind: "error",
        });
      }
      if (!this.activeFilePath || filePathKey(this.activeFilePath) !== documentKey) return;
      const currentText = this.editorInstance.state.doc.toString();
      const currentConfig = this.typographyController.fromText(currentText);
      if (!currentConfig || signature(currentConfig.fonts) !== signature(config.fonts)) {
        this.scheduleManualTypographyScaleCheck();
        return;
      }
      const corrected = this.typographyController.resetUnsupportedInternalScales(currentConfig, unsupportedInternalScale.fonts);
      const edit = parseTypographyBlock(currentText)
        ? typographyEdit(currentText, corrected)
        : documentScriptsEdit(currentText, corrected.fonts);
      this.suppressTypographyScaleConfirmation = true;
      try {
        this.editorInstance.dispatch({
          changes: edit,
          userEvent: "input.typography-scale-correction",
        });
      } finally {
        this.suppressTypographyScaleConfirmation = false;
      }
      this.lastTypographyInternalScaleError = "";
      this.acceptedTypographyScales.set(documentKey, corrected.fonts.map(font => ({ ...font })));
      await this.applyManualTypographyFontChange(corrected, filePath);
      return;
    }
    this.lastTypographyInternalScaleError = "";
    const requiresConfirmation = config.fonts.some(font => {
      if (Math.abs(font.scale - 1) <= 0.0001) return false;
      const previous = previousFonts.find(candidate =>
        candidate.script === font.script && candidate.family === font.family
      );
      return !previous || Math.abs(previous.scale - font.scale) > 0.0001;
    });

    if (!requiresConfirmation) {
      this.acceptedTypographyScales.set(documentKey, config.fonts.map(font => ({ ...font })));
      await this.applyManualTypographyFontChange(config, filePath);
      return;
    }

    this.typographyScaleConfirmationOpen = true;
    let accepted = false;
    try {
      const rangeWarning = this.typographyController.scaleRangeWarning(config);
      const variantWarning = this.typographyController.variantLimitWarning(
        await this.typographyController.scaledFontSetStatus(config),
      );
      const warning = [rangeWarning, variantWarning].filter((value): value is string => Boolean(value)).join("\n\n");
      accepted = await confirm(
        warning
          || `Apply these document font scales?\n\n${config.fonts.map(font => `${font.family}: ${font.scale}×`).join("\n")}\n\nTypsastra will prepare the required variants in its private global font cache and restart the preview compiler. No font data is written into the project. Non-1× scaling is experimental for PDF output because Typst may normalize scaled fonts while subsetting them. Use 1× for dependable PDF export.`,
        {
          title: variantWarning
            ? "Font Variant Cache Limit"
            : (rangeWarning ? "Large Font Scale Adjustment" : "Confirm Font Scaling"),
          kind: "warning"
        }
      );
    } finally {
      this.typographyScaleConfirmationOpen = false;
    }

    if (!this.activeFilePath || filePathKey(this.activeFilePath) !== documentKey) return;
    const currentText = this.editorInstance.state.doc.toString();
    const currentConfig = this.typographyController.fromText(currentText);
    if (!currentConfig || signature(currentConfig.fonts) !== signature(config.fonts)) {
      this.scheduleManualTypographyScaleCheck();
      return;
    }
    if (accepted) {
      this.acceptedTypographyScales.set(documentKey, currentConfig.fonts.map(font => ({ ...font })));
      await this.applyManualTypographyFontChange(currentConfig, filePath);
      return;
    }

    const revertedConfig = {
      ...currentConfig,
      fonts: currentConfig.fonts.map(font => ({
        ...font,
        scale: previousFonts.find(candidate =>
          candidate.script === font.script && candidate.family === font.family
        )?.scale ?? 1
      }))
    };
    const edit = parseTypographyBlock(currentText)
      ? typographyEdit(currentText, revertedConfig)
      : documentScriptsEdit(currentText, revertedConfig.fonts);
    this.suppressTypographyScaleConfirmation = true;
    try {
      this.editorInstance.dispatch({
        changes: edit,
        userEvent: "input.typography-scale-revert"
      });
    } finally {
      this.suppressTypographyScaleConfirmation = false;
    }
  }

  private async applyManualTypographyFontChange(config: DocumentTypography, filePath: string): Promise<void> {
    try {
      const fontsChanged = await this.updateWorkspaceTypographyFont(config);
      if (!fontsChanged) return;
      if (this.activeFilePath && filePathKey(this.activeFilePath) === filePathKey(filePath)) {
        await this.refreshActivePreviewRoot(true);
      }
    } catch (error) {
      this.appendLspLog({
        kind: "error",
        source: "typography",
        message: `Unable to prepare the manually selected font scale: ${String(error)}`
      });
      await message(String(error), { title: "Unable to Scale Font", kind: "error" });
    }
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


  private async handleInverseSync(uri: string | undefined, position: LspSourcePosition): Promise<LspInverseSyncResult> {
    this.appendDeveloperLog({
      kind: "info",
      source: "inverse sync",
      message: `Compiler source response: uri=${uri ?? "n/a"}, line=${position.line}, character=${position.character ?? 0}.`
    });
    if (!this.previewSyncController.hasRecentPreviewClick()) {
      this.appendDeveloperLog({
        kind: "warning",
        source: "inverse sync",
        message: "Ignored inverse sync because it did not originate from Typsastra's docked DOM-intercepted preview."
      });
      return { handled: true };
    }

    const rawTargetPath = uri ? filePathFromUri(uri) : null;
    let targetPath = rawTargetPath ? this.mapToOriginalPath(rawTargetPath) : null;
    const existingTargetTab = targetPath
      ? this.openTabs.find((tab) => filePathKey(tab.path) === filePathKey(targetPath))
      : null;
    const resolvedTargetPath = existingTargetTab?.path ?? targetPath;
    if (resolvedTargetPath && filePathKey(resolvedTargetPath) !== filePathKey(this.activeFilePath ?? "")) {
      let isStandalone = false;
      if (existingTargetTab) {
        isStandalone = allowsStandalonePreview(existingTargetTab.content);
      } else {
        try {
          const contents = await invoke<string>("read_workspace_file", { path: resolvedTargetPath });
          isStandalone = allowsStandalonePreview(contents);
        } catch {
          // ignore
        }
      }
      await this.loadFile(resolvedTargetPath, {
        preservePreviewSession: isStandalone ? undefined : this.capturePreviewSession()
      });
      if (!this.getActiveTab()?.contentLoaded) return { handled: true };
    }

    if (this.activeMode === "WYSIWYM") {
      this.switchViewLayoutMode();
    }

    this.previewSyncController.clearForward();
    
    let cursor = 0;
    if (rawTargetPath && targetPath && this.isRenderCachePath(rawTargetPath)) {
      const relPath = targetPath.startsWith(this.workspaceRootPath!)
        ? targetPath.substring(this.workspaceRootPath!.length).replace(/^[/\\]+/, "")
        : targetPath;
      const cacheContent = await this.pdfGeneratedPreviewText(targetPath);
      cursor = await this.mapCacheLspPositionToOriginalEditorOffset(relPath, position, cacheContent) ?? 0;
    } else {
      cursor = this.editorPositionFromLspPosition(position) ?? 0;
      this.appendDeveloperLog({
        kind: "info",
        source: "inverse sync",
        message: `Compiler inverse position mapped directly: line=${position.line + 1}, character=${position.character ?? 0}, offset=${cursor}.`
      });
    }

    await this.applyInverseSyncSelection(cursor);
    return { handled: true };
  }

  private async applyInverseSyncSelection(cursor: number): Promise<void> {
    const editor = this.editorInstance;
    const target = Math.max(0, Math.min(cursor, editor.state.doc.length));
    await nextAnimationFrame();
    editor.dispatch({
      selection: { anchor: target },
      effects: EditorView.scrollIntoView(target, { y: "center" })
    });
    editor.focus();
    window.setTimeout(() => {
      if (this.editorInstance !== editor) return;
      if (editor.state.selection.main.head !== target) return;
      editor.dispatch({
        effects: EditorView.scrollIntoView(target, { y: "center" })
      });
    }, 60);
    this.scheduleEditorCaretRipple(editor, target);
    this.appendDeveloperLog({
      kind: "info",
      source: "inverse sync",
      message: `Editor inverse position applied: offset=${target}.`
    });
  }

  private scheduleEditorCaretRipple(editor: EditorView, cursor: number): void {
    let shown = false;
    const show = () => {
      if (shown) return;
      if (this.editorInstance !== editor) return;
      if (editor.state.selection.main.head !== cursor) return;
      shown = this.showEditorCaretRipple(editor, cursor);
    };
    window.setTimeout(show, 90);
    window.setTimeout(show, 180);
  }

  private showEditorCaretRipple(editor: EditorView, cursor: number): boolean {
    const coords = editor.coordsAtPos(cursor);
    if (!coords) return false;
    document.querySelectorAll(".typsastra-editor-caret-ripple").forEach(element => element.remove());
    const ripple = document.createElement("div");
    ripple.className = "typsastra-editor-caret-ripple";
    Object.assign(ripple.style, {
      position: "fixed",
      left: `${coords.left}px`,
      top: `${(coords.top + coords.bottom) / 2}px`,
      width: "18px",
      height: "18px",
      margin: "-9px 0 0 -9px",
      border: `2px solid ${TYPSASTRA_GREEN}`,
      borderRadius: "999px",
      background: TYPSASTRA_GREEN_RIPPLE_FILL,
      boxShadow: `0 0 0 0 ${TYPSASTRA_GREEN_RIPPLE_SHADOW}`,
      pointerEvents: "none",
      zIndex: "2147483647",
      animation: "typsastra-editor-caret-ripple 900ms ease-out forwards"
    });
    ensureEditorCaretRippleStyle();
    document.body.appendChild(ripple);
    window.setTimeout(() => {
      if (ripple.isConnected) ripple.remove();
    }, 1000);
    return true;
  }

  private revealCursorInPreviewManually(): void {
    const path = this.activeFilePath;
    if (!path?.toLowerCase().endsWith(".typ")) {
      this.setLspStatus({ kind: "preview-ready", message: "Open a Typst file to reveal it in preview" });
      return;
    }
    this.previewSyncController.requestManual(path, this.editorInstance.state.selection.main.head);
  }

  private cancelManualForwardSync(): void {
    this.previewSyncController.cancelManual();
  }

  private updateManualForwardSyncAction(): void {
    this.previewSyncController.refreshManualAction();
  }

  private renderManualForwardSyncAction(busy: boolean, available: boolean): void {
    const button = document.getElementById("preview-forward-sync-btn") as HTMLButtonElement | null;
    if (!button) return;
    const shortcut = navigator.userAgent.toLowerCase().includes("mac") ? "Option+Enter" : "Alt+Enter";
    button.disabled = busy || !available;
    button.setAttribute("aria-busy", String(busy));
    button.title = busy
      ? "Locating cursor in preview..."
      : available
        ? `Reveal Cursor in Preview (${shortcut})`
        : "Reveal cursor is available when a compiled preview is ready";
  }

  private async forwardSyncTarget(path: string, cursor: number): Promise<{ filepath: string; line: number; character: number } | null> {
    const editor = this.editorInstance;
    const position = Math.max(0, Math.min(cursor, editor.state.doc.length));
    // Template-aware standalone wrappers use workspace-root (`/...`) imports.
    // Those imports retain the original source IDs even when the wrapper itself
    // is mirrored into the render cache.
    const keepsOriginalSourceIdentity = usesTemplateAwareStandaloneRoot(
      path,
      this.previewRootPath,
      this.previewStandalone
    );
    let generated = keepsOriginalSourceIdentity
      ? undefined
      : this.pdfPreviewGeneratedFiles.get(filePathKey(path));
    if (
      !keepsOriginalSourceIdentity
      && !generated
      && this.isRenderCachePath(this.pdfPreviewSourceMapRootPath ?? "")
    ) {
      // On-save preparation mirrors files without creating editor overlays, so
      // its generated-file registry starts empty. A real inverse sync used to
      // populate this entry lazily, which accidentally made the *second*
      // forward sync work. Load the prepared source before the first request so
      // Tinymist receives the cache path owned by the hidden source-map task.
      await this.pdfGeneratedPreviewText(this.mapToOriginalPath(path));
      generated = this.pdfPreviewGeneratedFiles.get(filePathKey(path));
      this.appendDeveloperLog({
        kind: generated ? "info" : "warning",
        source: "forward sync",
        message: generated
          ? `Loaded prepared source identity before forward sync: original=${path}, generated=${generated.generatedPath}.`
          : `Could not load prepared source identity before forward sync: ${path}.`
      });
    }
    if (!generated) {
      const line = editor.state.doc.lineAt(position);
      return {
        filepath: path,
        line: line.number - 1,
        character: tinymistPreviewPreferredSourceColumn(line.text, position - line.from)
      };
    }

    const cacheRoot = this.getCacheRootPath();
    if (!cacheRoot || !this.workspaceRootPath) return null;

    const originalContent = editor.state.doc.toString();
    const sourceByteOffset = new TextEncoder().encode(originalContent.slice(0, position)).length;
    const relativePath = path.startsWith(this.workspaceRootPath)
      ? path.substring(this.workspaceRootPath.length).replace(/^[/\\]+/, "")
      : path;
    const generatedByteOffset = await invoke<number | null>("map_source_to_generated", {
      cacheRoot,
      relativePath,
      sourceOffset: sourceByteOffset
    }).catch(() => null);
    if (generatedByteOffset === null || generatedByteOffset === undefined) return null;

    const generatedOffset = this.utf8ByteOffsetToStringOffset(generated.preparedText, generatedByteOffset);
    const generatedDoc = EditorState.create({ doc: generated.preparedText }).doc;
    const line = generatedDoc.lineAt(Math.max(0, Math.min(generatedOffset, generatedDoc.length)));
    return {
      filepath: generated.generatedPath,
      line: line.number - 1,
      character: tinymistPreviewPreferredSourceColumn(line.text, generatedOffset - line.from)
    };
  }

  private async handlePdfPreviewClick(point: PreviewClickPoint): Promise<void> {
    const isPreviewWindow = isPreviewOnlyWindow();
    if (isPreviewWindow) {
      import("@tauri-apps/api/event").then(({ emit }) => {
        emit("pdf-click", point);
      }).catch(err => console.error("Error emitting pdf-click", err));
      return;
    }
    if (point.draftImageId) {
      await this.navigateToDraftPreviewImage(point.draftImageId);
      return;
    }
    if (!this.activeFilePath || !isTypstDocumentPath(this.activeFilePath)) {
      this.appendDeveloperLog({
        kind: "info",
        source: "preview iframe",
        message: "Ignored source-sync click because the active preview is a direct PDF document."
      });
      return;
    }
    await this.previewSyncController.sendInverse(point);
  }

  private async navigateToDraftPreviewImage(id: string): Promise<void> {
    if (this.presentedPreviewContentMode !== "draft" || !/^[a-f0-9]{24}$/.test(id)) return;
    const asset = this.draftImageAssets.get(id);
    if (!asset || asset.references.length === 0) return;
    const activePathKey = filePathKey(this.activeFilePath ?? "");
    const reference = asset.references.find(candidate =>
      filePathKey(candidate.sourcePath) === activePathKey
    ) ?? asset.references[0];
    this.appendDeveloperLog({
      kind: "info",
      source: "inverse sync",
      message: `Draft placeholder resolved directly to ${reference.sourcePath}:${reference.fromUtf16}.`
    });
    await this.navigateToLogEntry({
      kind: "info",
      source: "inverse sync",
      message: "Draft Preview image",
      filePath: reference.sourcePath,
      fileName: fileNameFromPath(reference.sourcePath),
      offset: reference.fromUtf16,
      toOffset: reference.toUtf16
    });
  }

  private updatePreviewZoomLabel(zoomPercent?: number) {
    const label = document.getElementById("preview-zoom-label");
    if (!label) return;

    const imageZoomPercent = this.imagePreviewController.zoomPercent;
    const imageIsFit = this.imagePreviewController.isFit;
    if (imageZoomPercent !== null && imageIsFit !== null) {
      const pct = Math.round((zoomPercent ?? imageZoomPercent) * 100);
      label.textContent = imageIsFit ? "Fit" : `${pct}%`;
    } else {
      const pct = zoomPercent ?? this.previewFrame.currentZoomPercent;
      label.textContent = this.previewFrame.isFitMode ? "Fit" : `${pct}%`;
    }
  }

  private schedulePdfSourceMapWarmup(generation: number): void {
    this.previewSyncController.scheduleWarmup(generation);
  }

  private initializePreviewPageControls(): void {
    const input = document.getElementById("preview-page-input") as HTMLInputElement | null;
    if (!input || input.dataset.initialized === "true") return;
    input.dataset.initialized = "true";
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.commitPreviewPageInput();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        input.value = String(this.previewPageStatus.currentPage || 1);
        input.blur();
      }
    });
    input.addEventListener("change", () => this.commitPreviewPageInput());
    input.addEventListener("wheel", event => {
      if (document.activeElement === input) event.preventDefault();
    }, { passive: false });
    this.updatePreviewPageStatus(this.previewPageStatus);
  }

  private commitPreviewPageInput(): void {
    const input = document.getElementById("preview-page-input") as HTMLInputElement | null;
    if (!input || this.previewPageStatus.pageCount < 1) return;
    const value = input.value.trim();
    if (!/^\d+$/.test(value)) {
      input.value = String(this.previewPageStatus.currentPage || 1);
      return;
    }
    const requested = Number.parseInt(value, 10);
    const pageNo = Math.max(1, Math.min(requested, this.previewPageStatus.pageCount));
    input.value = String(pageNo);
    this.previewFrame.scrollToPage(pageNo);
  }

  private updatePreviewPageStatus(status: PreviewPageStatus): void {
    this.previewPageStatus = status;
    const input = document.getElementById("preview-page-input") as HTMLInputElement | null;
    const count = document.getElementById("preview-page-count");
    if (input) {
      input.disabled = status.pageCount < 1;
      if (document.activeElement !== input) input.value = String(status.currentPage || 1);
      input.setAttribute("aria-valuemin", "1");
      input.setAttribute("aria-valuemax", String(Math.max(1, status.pageCount)));
      input.setAttribute("aria-valuenow", String(status.currentPage || 1));
    }
    if (count) count.textContent = String(status.pageCount);
  }

  private updatePreviewActionsToolbar(path: string | null): void {
    const previewActions = document.querySelector(".preview-actions");
    if (!previewActions) return;

    if (!path) {
      previewActions.classList.add("hidden");
      previewActions.classList.remove("markdown-preview-toolbar");
      this.markdownPreviewFrame.deactivate();
      this.setMarkdownPreviewActive(false);
      return;
    }

    const ext = fileExtension(path);
    const isImage = isBinaryImagePath(path);
    const isPdf = ext === "pdf";
    const isMarkdown = isMarkdownDocumentPath(path);
    const isUnsupported = !this.isInternallySupportedPath(path);

    if (isUnsupported && !isImage && !isPdf) {
      previewActions.classList.add("hidden");
      return;
    }

    previewActions.classList.remove("hidden");
    previewActions.classList.toggle("markdown-preview-toolbar", isMarkdown);

    const showTypstOnly = isTypstDocumentPath(path);
    const contentModeToggle = document.getElementById("preview-content-mode-toggle");

    const syncBtn = document.getElementById("preview-forward-sync-btn");
    const recompileBtn = document.getElementById("preview-recompile-btn");
    const menuBtn = document.getElementById("preview-menu-btn");
    const imageWarningBtn = document.getElementById("preview-image-warning-btn");
    document.querySelector<HTMLElement>(".preview-page-controls")?.classList.toggle("hidden", isImage || isMarkdown);

    if (syncBtn) {
      if (showTypstOnly) syncBtn.classList.remove("hidden");
      else syncBtn.classList.add("hidden");
    }
    if (recompileBtn) {
      if (showTypstOnly) recompileBtn.classList.remove("hidden");
      else recompileBtn.classList.add("hidden");
    }
    if (menuBtn) {
      if (showTypstOnly) menuBtn.classList.remove("hidden");
      else menuBtn.classList.add("hidden");
    }
    imageWarningBtn?.classList.toggle(
      "hidden",
      !showTypstOnly || imageWarningBtn.dataset.active !== "true"
    );
    contentModeToggle?.classList.toggle("hidden", !showTypstOnly);
    this.updatePreviewContentModeControl();
  }

  private zoomIn(): void {
    if (!this.imagePreviewController.zoomIn()) {
      this.previewFrame.zoomIn();
      this.updatePreviewZoomLabel();
    }
  }

  private zoomOut(): void {
    if (!this.imagePreviewController.zoomOut()) {
      this.previewFrame.zoomOut();
      this.updatePreviewZoomLabel();
    }
  }

  private zoomToFit(): void {
    if (!this.imagePreviewController.zoomToFit()) {
      this.previewFrame.zoomToFit();
      this.updatePreviewZoomLabel();
    }
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
    if (!this.settingsController.value.developerMode) return;
    if (!this.activeFilePath || !isTypstDocumentPath(this.activeFilePath)) {
      if (status.kind === "installed") {
        this.appendDeveloperLog({
          kind: "info",
          source: "preview iframe",
          message: `PDF interaction listener installed for ${status.url}; source synchronization is disabled for direct PDF documents.`
        });
      }
      return;
    }
    if (status.kind === "debug") {
      this.appendDeveloperLog({
        kind: "info",
        source: "preview iframe",
        message: status.reason ?? `Debug event for ${status.url}`
      });
      return;
    }
    if (status.kind === "installed") {
      this.setLspStatus({ kind: "preview-ready", message: "Inverse sync source-map active" });
      this.appendDeveloperLog({
        kind: "info",
        source: "inverse sync",
        message: `Preview source-map click interception installed for ${status.url}`
      });
      return;
    }
    this.setLspStatus({ kind: "preview-ready", message: "Inverse sync source-map blocked" });
    this.appendDeveloperLog({
      kind: "warning",
      source: "inverse sync",
      message: `Preview source-map click interception blocked for ${status.url}: ${status.reason ?? "unknown reason"}. Inverse sync will use Tinymist's raw source position only.`
    });
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

  private previewPackageFailureHint(
    failure: PreviewCompilerFailure,
    preparedPreview: PreparedPdfPreview | null,
  ): Promise<PreviewPackageFailureHint | null> {
    return this.previewFailureController.packageFailureHint(
      failure,
      preparedPreview?.reachableSourcePaths ?? [],
    );
  }

  private publishPreviewCompilerFailure(
    failure: PreviewCompilerFailure,
    packageHint: PreviewPackageFailureHint | null,
  ): void {
    this.previewFailureController.publish(failure, packageHint);
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

  private loadWorkspaceMetadata(workspacePath: string): Promise<WorkspaceMetadata> {
    return this.workspaceController.loadMetadata(workspacePath);
  }

  private absoluteWorkspacePath(workspacePath: string, relativePath: string | null): Promise<string | null> {
    return this.workspaceController.absolutePath(workspacePath, relativePath);
  }
  private async restoreWorkspaceState(workspacePath: string, metadata: WorkspaceMetadata) {
    try {
      const state = metadata.workspace;
      const project = metadata.project;
      this.previewScrollTop = state.previewScrollTop;
      this.previewFrame.restoreWorkspaceScrollPosition(state.previewScrollTop);
      const inputContainer = document.getElementById("input-container-wrapper");
      const previewContainerWrapper = document.getElementById("preview-container-wrapper");
      this.layoutController.setDockedInputWidthPct(state.layout.inputContainerWidthPct);
      inputContainer!.style.width = `${state.layout.inputContainerWidthPct}%`;
      if (previewContainerWrapper) previewContainerWrapper.style.width = `${100 - state.layout.inputContainerWidthPct}%`;
      this.sidebarController.restore({
        visible: state.layout.sidebarVisible,
        activeTool: state.layout.activeSidebarTool,
      });
      const pinnedMainFilePath = await this.absoluteWorkspacePath(workspacePath, project.mainFile);
      this.pinnedMainFilePath = pinnedMainFilePath
        && await invoke<boolean>("workspace_path_exists", { path: pinnedMainFilePath })
        ? pinnedMainFilePath
        : null;
      this.mainDocumentScripts = this.pinnedMainFilePath
        ? parseDocumentScripts(await invoke<string>("read_workspace_text_prefix", {
            path: this.pinnedMainFilePath,
            maxBytes: 65_536,
          }))
        : [];
      if (project.mainFile && !this.pinnedMainFilePath) metadata.project.mainFile = null;
      const explorerSidebar = document.getElementById("explorer-sidebar");
      if (explorerSidebar) explorerSidebar.style.width = `${state.layout.explorerSidebarWidthPx}px`;

      const restoredTabs = await Promise.all(state.openTabs.map(async tabInfo => ({
        tabInfo,
        path: await this.absoluteWorkspacePath(workspacePath, tabInfo.path)
      })));
      for (const { tabInfo, path } of restoredTabs) {
        if (!path) continue;
        if (this.openTabs.some(tab => filePathKey(tab.path) === filePathKey(path))) continue;
        this.openTabs.push({
          path,
          content: "",
          savedContent: "",
          contentLoaded: !isSupportedInAppPath(path),
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
          selectionAnchor: tabInfo.selectionAnchor || 0,
          selectionHead: tabInfo.selectionHead || 0,
          scrollTop: tabInfo.scrollTop,
          scrollLeft: tabInfo.scrollLeft,
          // Bounds are validated after this tab is hydrated.
          foldRanges: tabInfo.foldState === "user" && Array.isArray(tabInfo.foldRanges)
            ? tabInfo.foldRanges as EditorFoldRange[]
            : [],
          foldStateExplicit: tabInfo.foldState === "user"
        });
      }
      this.renderEditorTabs();

      if (this.openTabs.length === 0) {
        for (const candidate of workspaceRestoreCandidates(metadata)) {
          const path = await this.absoluteWorkspacePath(workspacePath, candidate);
          if (path && await invoke<boolean>("workspace_path_exists", { path })) {
            await this.loadFile(path, { skipPreviewActivation: true });
            return;
          }
        }
      }

      const activeFilePath = await this.absoluteWorkspacePath(workspacePath, state.activeFile);
      const preferredTab = activeFilePath
        ? this.openTabs.find(tab => filePathKey(tab.path) === filePathKey(activeFilePath))
        : null;
      const activationCandidates = preferredTab
        ? [preferredTab, ...this.openTabs.filter(tab => tab !== preferredTab)]
        : [...this.openTabs];
      for (const tab of activationCandidates) {
        try {
          await this.activateEditorTab(tab.path, false, { skipPreviewActivation: true });
          break;
        } catch (error) {
          console.warn("Failed to restore tab:", tab.path, error);
          this.openTabs = this.openTabs.filter(candidate => candidate !== tab);
          this.renderEditorTabs();
        }
      }
      if (!this.activeFilePath) {
        for (const candidate of workspaceRestoreCandidates(metadata)) {
          const path = await this.absoluteWorkspacePath(workspacePath, candidate);
          if (!path || this.openTabs.some(tab => filePathKey(tab.path) === filePathKey(path))) continue;
          if (!await invoke<boolean>("workspace_path_exists", { path })) continue;
          await this.loadFile(path, { skipPreviewActivation: true });
          if (this.activeFilePath) break;
        }
      }
    } catch (e) {
      console.warn("Failed to restore workspace state:", e);
      throw e;
    }
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
        || this.queuedPdfPreviewContents !== null
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
    return (
      `<div class="preview-disabled-placeholder">` +
      `<div class="preview-disabled-title preview-accent-title" style="font-size:18px;margin-bottom:12px;">No Main File Selected</div>` +
      `<div class="preview-disabled-msg">Right-click any <code style="background:var(--ui-hover);padding:1px 5px;border-radius:3px;">.typ</code> file in the Explorer and choose <strong>Set as Main File</strong> to enable live preview and export.</div>` +
      `</div>`
    );
  }

  private disabledPreviewMessage(): string {
    return (
      `<div class="preview-disabled-placeholder">` +
      `<div class="preview-disabled-icon">🚫</div>` +
      `<div class="preview-disabled-title">Preview Unavailable</div>` +
      `<div class="preview-disabled-msg">This file is not imported or included by the main document. Only the main file and its dependencies are previewed.</div>` +
      `<div class="preview-disabled-msg" style="margin-top: 8px; font-size: 12px; opacity: 0.75;">Include this file from the configured main document to preview it.</div>` +
      `</div>`
    );
  }

  private renderNonTextEditorPlaceholder(path: string, unsupported: boolean): void {
    const info = document.getElementById("image-viewer-info");
    if (!info) return;

    const placeholder = document.createElement("div");
    placeholder.className = "preview-disabled-placeholder editor-file-placeholder";

    const isPdf = fileExtension(path) === "pdf";

    const icon = document.createElement("div");
    icon.className = "preview-disabled-icon";
    icon.textContent = isPdf ? "\u{1F4C4}" : (unsupported ? "\u{1F4C4}" : "\u{1F4BE}");

    const title = document.createElement("div");
    title.className = "preview-disabled-title";
    title.textContent = isPdf ? "PDF Document" : (unsupported ? "Unsupported File" : "Binary File");

    const fileName = document.createElement("div");
    fileName.className = "editor-file-placeholder-name";
    fileName.textContent = fileNameFromPath(path);

    const description = document.createElement("div");
    description.className = "preview-disabled-msg";
    description.textContent = isPdf
      ? "This document is displayed in the live preview pane."
      : unsupported
        ? "This file format cannot be displayed in Typsastra."
        : "Cannot load raw binary in the text editor.";

    placeholder.append(icon, title, fileName, description);
    if (unsupported || isPdf) {
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "editor-file-placeholder-action";
      openButton.textContent = "Open Externally";
      openButton.addEventListener("click", () => {
        void this.openFileExternally(path, openButton);
      });
      placeholder.appendChild(openButton);
    }
    info.replaceChildren(placeholder);
  }

  private showLargeFileConfirmation(tab: EditorTab, notice: LargeFileOpeningNotice): void {
    const path = tab.path;
    const codeRenderPane = document.getElementById("code-render-pane");
    const imageViewerPane = document.getElementById("image-viewer-pane");
    const imageViewerImg = document.getElementById("image-viewer-img") as HTMLImageElement | null;
    const info = document.getElementById("image-viewer-info");

    codeRenderPane?.classList.add("hidden");
    imageViewerPane?.classList.remove("hidden");
    if (imageViewerImg) imageViewerImg.style.display = "none";
    document.getElementById("wysiwym-editor-pane")?.classList.add("hidden");

    if (notice.kind === "pdf") {
      // A guarded PDF owns the preview pane as soon as its tab is selected.
      // Leaving the previous compiler preview mounted makes it appear that the
      // unopened PDF is already visible and allows an in-flight Typst render
      // to repaint the stale document behind the confirmation.
      this.blockedLargePdfPaths.add(filePathKey(path));
      this.pdfLoadRequestGeneration += 1;
      this.invalidatePreviewWork(`waiting for confirmation to open ${path}`);
    } else if (isTypstDocumentPath(path)) {
      this.workspaceServicesDeferredForLargeFile = true;
      this.blockedLargePreviewRoot = notice.previewRootPath ?? path;
      this.previewFrame.setMessage(
        `<div class="preview-disabled-placeholder guardrail-paired-placeholder guardrail-preview-placeholder">` +
        `<div class="guardrail-placeholder-content">` +
        `<div class="preview-disabled-title">Preview Not Started</div>` +
        `<div class="preview-disabled-msg">The compiler preview will start after you confirm opening the large Typst file.</div>` +
        `</div></div>`
      );
    } else {
      this.previewFrame.setMessage(
        `<div class="preview-disabled-placeholder">` +
        `<div class="preview-disabled-title">Preview Unavailable</div>` +
        `<div class="preview-disabled-msg">Live preview is not supported for this text file.</div>` +
        `</div>`
      );
    }

    if (info) {
      const placeholder = document.createElement("div");
      placeholder.className = "preview-disabled-placeholder editor-file-placeholder guardrail-paired-placeholder";
      const content = document.createElement("div");
      content.className = "guardrail-placeholder-content";

      const icon = document.createElement("div");
      icon.className = "preview-disabled-icon";
      icon.textContent = "📄";

      const title = document.createElement("div");
      title.className = "preview-disabled-title";
      title.textContent = notice.kind === "pdf"
        ? "Large PDF Document"
        : isTypstDocumentPath(path)
          ? "Large Typst Document"
          : "Large Text File";

      const fileName = document.createElement("div");
      fileName.className = "editor-file-placeholder-name";
      fileName.textContent = fileNameFromPath(path);

      const description = document.createElement("div");
      description.className = "preview-disabled-msg";
      const work = notice.kind === "pdf"
        ? "Confirm in the preview pane before Typsastra decodes and renders it."
        : notice.kind === "main-preview"
          ? `This file belongs to a large preview rooted at ${fileNameFromPath(notice.previewRootPath ?? "the configured main file")}. Opening it will initialize the editor and start that compiler preview.`
          : isTypstDocumentPath(path)
            ? "Opening it will initialize the editor and start its compiler preview."
          : "Opening it will initialize the editor, folding, outline, and language tools.";
      const scale = notice.lineCount !== undefined
        ? `${notice.lineCount.toLocaleString()} lines, ${formatFileSize(notice.sizeBytes)}`
        : formatFileSize(notice.sizeBytes);
      description.textContent = notice.kind === "main-preview"
        ? `The effective preview contains ${scale}. ${work}`
        : `This file is ${scale}. ${work}`;

      const openConfirmedFile = async () => {
        if (notice.kind === "pdf") {
          this.blockedLargePdfPaths.delete(filePathKey(path));
        } else if (isTypstDocumentPath(path)) {
          await this.approveLargePreviewForTab(tab, notice);
        }
        try {
          await this.activateEditorTab(path, false, { largeFileConfirmed: true });
        } catch (error) {
          if (notice.kind === "pdf") {
            this.blockedLargePdfPaths.add(filePathKey(path));
          }
          throw error;
        }
      };

      content.append(icon, title, fileName, description);
      if (notice.kind === "pdf") {
        this.previewFrame.setConfirmationMessage({
          title: "Large PDF Preview Not Started",
          message: `${fileNameFromPath(path)} is ${formatFileSize(notice.sizeBytes)}. Opening it will decode the PDF and begin rendering visible pages.`,
          confirmLabel: "Open Large PDF",
          pairedGuardrail: true,
          onConfirm: openConfirmedFile
        });
      } else {
        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.className = "editor-file-placeholder-action";
        const confirmLabel = isTypstDocumentPath(path) ? "Open and Compile Preview" : "Open Large File";
        confirmButton.textContent = confirmLabel;
        confirmButton.addEventListener("click", () => {
          confirmButton.disabled = true;
          confirmButton.textContent = "Opening…";
          void openConfirmedFile().catch(error => {
            console.error("Failed to open large file:", error);
            confirmButton.disabled = false;
            confirmButton.textContent = confirmLabel;
            void message(`Could not open ${fileNameFromPath(path)}: ${String(error)}`, {
              title: "Unable to Open File",
              kind: "error"
            });
          });
        });
        content.append(confirmButton);
      }
      placeholder.append(content);
      info.replaceChildren(placeholder);
    }
    this.observeGuardrailAlignment();

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
  }

  private observeGuardrailAlignment(): void {
    this.guardrailAlignmentObserver?.disconnect();
    const editorHost = document.getElementById("image-viewer-pane");
    const previewHost = document.getElementById("preview-render-pane");
    const previewContent = previewHost?.querySelector<HTMLElement>(
      ".guardrail-preview-placeholder .guardrail-placeholder-content"
    );
    if (!editorHost || !previewHost || !previewContent) return;

    const align = () => {
      const editorRect = editorHost.getBoundingClientRect();
      const previewRect = previewHost.getBoundingClientRect();
      const editorCenter = editorRect.top + editorRect.height / 2;
      const previewCenter = previewRect.top + previewRect.height / 2;
      previewContent.style.setProperty("--guardrail-center-offset", `${editorCenter - previewCenter}px`);
    };
    align();
    this.guardrailAlignmentObserver = new ResizeObserver(align);
    this.guardrailAlignmentObserver.observe(editorHost);
    this.guardrailAlignmentObserver.observe(previewHost);
    const editorToolbar = document.getElementById("editor-visual-toolbar");
    if (editorToolbar) this.guardrailAlignmentObserver.observe(editorToolbar);
  }

  private clearGuardrailAlignment(): void {
    this.guardrailAlignmentObserver?.disconnect();
    this.guardrailAlignmentObserver = null;
  }

  private async openFileExternally(path: string, button?: HTMLButtonElement): Promise<void> {
    if (button) button.disabled = true;
    try {
      await invoke("open_file_externally", { path });
    } catch (error) {
      console.error("Failed to open file externally:", error);
      await message(`The file could not be opened externally.\n\n${String(error)}`, {
        title: "Open External File Failed",
        kind: "error"
      });
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  private renderImageToolPreview(source: string | null, imagePath?: string): void {
    if (this.sidebarController.activeTool !== "images") return;
    if (!source) {
      this.imagePreviewController.clear();
      this.updatePreviewActionsToolbar(imagePath ?? "image-tools.png");
      this.previewFrame.setMessage(
        `<div class="preview-disabled-placeholder">` +
        `<div class="guardrail-placeholder-content">` +
        `<div class="preview-disabled-title preview-accent-title">Image Preview</div>` +
        `<div class="preview-disabled-msg">${imagePath ? "Loading the selected image preview." : "Select an image in the sidebar to preview it."}</div>` +
        `</div></div>`
      );
      return;
    }
    this.renderInteractiveImageViewer(source, imagePath);
  }

  private renderInteractiveImageViewer(
    src: string,
    previewPath = this.activeFilePath ?? "preview.png",
  ): void {
    this.imagePreviewController.render(src, previewPath);
  }
  private async refreshActivePreviewRoot(forceRender = false): Promise<void> {
    if (this.sidebarController.activeTool === "images") return;
    if (!this.activeFilePath) return;
    const path = this.activeFilePath;
    const ext = fileExtension(path);
    const unsupportedFile = !this.isInternallySupportedPath(path);
    const isPdf = ext === "pdf";

    this.imagePreviewController.clear();

    this.updatePreviewActionsToolbar(path);

    if (unsupportedFile || isBinaryImagePath(path) || isPdf) {
      const tab = this.getActiveTab();
      if (!tab) return;
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
      return;
    }

    if (ext === "svg") {
      this.previewFrame.setMessageOverlay(
        `<div style="display:flex;align-items:center;justify-content:center;height:100%;width:100%;background:var(--ui-bg);box-sizing:border-box;padding:20px;overflow:auto;">` +
        this.editorInstance.state.doc.toString() +
        `</div>`
      );
      return;
    }
    if (!isTypstDocumentPath(path)) {
      this.previewFrame.setMessageOverlay(
        `<div class="preview-disabled-placeholder">` +
        `<div class="preview-disabled-title">Preview Unavailable</div>` +
        `<div class="preview-disabled-msg">Live preview is not supported for ${ext.toUpperCase() || "this"} files.</div>` +
        `</div>`
      );
      return;
    }
    if (!this.pinnedMainFilePath) {
      this.previewFrame.setMessage(this.noMainFileMessage());
      return;
    }
    const activeTab = this.getActiveTab();
    const contents = activeTab?.contentLoaded
      ? this.editorInstance.state.doc.toString()
      : normalizeEditorText(await invoke<string>("read_workspace_file", { path }));
    let target = await invoke<PreviewTarget>("resolve_preview_main", {
      filePath: this.activeFilePath,
      workspaceRootPath: this.workspaceRootPath,
      fileContents: contents,
      pinnedMainPath: this.pinnedMainFilePath
    });
    if (target.disabled) {
      if (activeTab) {
        this.applyPreviewTargetToTab(activeTab, target);
        this.configureDocumentLanguageTools(contents);
      }
      this.invalidatePreviewWork(`${this.activeFilePath} does not participate in the configured main preview`);
      this.previewFrame.setMessage(this.disabledPreviewMessage());
      return;
    }
    target = await this.prepareTemplateAwarePreview(target, this.activeFilePath, contents);
    if (!await this.ensureLargePreviewApproved(target.rootPath)) {
      const activeTab = this.getActiveTab();
      if (activeTab) {
        this.applyPreviewTargetToTab(activeTab, target);
        this.configureDocumentLanguageTools(contents);
      }
      return;
    }
    await this.updatePinnedMain(previewLspMainPath(target));
    const docIdentity = target.rootPath
      ? researchDocumentIdentity(
          this.workspaceRootPath ?? target.rootPath,
          target.mainPath,
          this.activeFilePath
        )
      : null;
    const identity = target.rootPath
      ? previewSessionIdentity(
          target.rootPath,
          previewRefreshStyle(this.effectivePreviewRenderMode),
          docIdentity ?? undefined
        )
      : null;
    const unchanged = identity?.key === this.previewSessionKey;
    if (!activeTab) return;
    this.applyPreviewTargetToTab(activeTab, target);
    this.configureDocumentLanguageTools(contents);
    // A tool surface can temporarily replace and unmount the preview without
    // changing the underlying document session. Only reuse an unchanged
    // session while its preview is still mounted; otherwise restore it.
    if (unchanged && !forceRender && this.previewFrame.currentUrl) return;

    if (!target.rootPath) {
      this.previewPane.innerHTML = `<div style="padding: 20px; color: var(--ui-header-text); font-family: var(--font-family-sans);">No preview root found for this library/template file. Diagnostics are still active.</div>`;
      return;
    }

    await this.renderPdfPreview(contents);
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

  private async openWorkspace(selected: string) {
    if (this.workspaceRootPath && filePathKey(this.workspaceRootPath) === filePathKey(selected)) {
      this.recentProjectsController.add(selected);
      return;
    }
    if (this.workspaceRootPath && this.workspaceRootPath !== selected) {
      const closed = await this.closeProject();
      if (!closed) return;
    }
    this.workspaceLoading = true;
    this.updateWorkspaceViewportVisibility();
    // Claim the target before the first asynchronous operation so repeated
    // open commands cannot start a second restoration of the same workspace.
    this.workspaceRootPath = selected;
    try {
      await invoke("cleanup_workspace_preview_files", { workspaceRootPath: selected });
      this.lspReady = false;
      this.workspaceMetadata = await this.loadWorkspaceMetadata(selected);
      this.workspaceMetadata.workspace.previewRenderMode ??=
        this.settingsController.value.preview.renderMode;
      this.settingsController.setWorkspacePreviewRenderMode(
        this.workspaceMetadata.workspace.previewRenderMode,
        mode => void this.setPreviewRenderMode(mode)
      );
      this.lastPreviewRenderMode = this.workspaceMetadata.workspace.previewRenderMode;
      this.previewContentMode = this.workspaceMetadata.workspace.previewContentMode;
      this.presentedPreviewContentMode = "normal";
      this.updatePreviewContentModeControl();
      this.spellcheckController.setTerminology(
        this.settingsController.value.editor.globalTerminology,
        this.workspaceMetadata.project.terminology,
        this.settingsController.value.editor.languageTerminology,
        this.settingsController.value.editor.scopedIgnoredWords,
      );
      this.settingsController.setProjectTerminology(
        this.workspaceMetadata.project.terminology,
        entries => {
          if (!this.workspaceMetadata) return;
          this.workspaceMetadata.project.terminology = entries;
          this.spellcheckController.setTerminology(
            this.settingsController.value.editor.globalTerminology,
            entries,
            this.settingsController.value.editor.languageTerminology,
            this.settingsController.value.editor.scopedIgnoredWords,
          );
          void this.saveWorkspaceState();
        },
      );
      await this.restoreWorkspaceToolchain(this.workspaceMetadata);
      const expandedDirectories = (await Promise.all(
        this.workspaceMetadata.workspace.expandedDirectories.map(path => this.absoluteWorkspacePath(selected, path))
      )).filter((path): path is string => !!path);
      await this.explorer.loadWorkspace(selected, expandedDirectories);
      await this.restoreWorkspaceState(selected, this.workspaceMetadata);
      await this.imageToolsController.setWorkspace(selected, this.pinnedMainFilePath);
      if (this.sidebarController.activeTool === "images") this.imageToolsController.show();
      if (this.activeFilePath) await this.explorer.revealPath(this.activeFilePath);
      await this.saveWorkspaceState();
      await this.explorer.loadWorkspace(selected);
      await this.workspaceController.startWatching(selected);
      this.recentProjectsController.add(selected);
    } catch (error) {
      this.workspaceController.stopWatching();
      this.workspaceRootPath = null;
      this.workspaceMetadata = null;
      this.activeFilePath = null;
      this.pinnedMainFilePath = null;
      this.mainDocumentScripts = [];
      this.openTabs = [];
      this.explorer.setActiveFile(null);
      this.explorer.clearWorkspace();
      this.renderEditorTabs();
      await message(String(error), { title: "Unable to Open Project", kind: "error" });
      return;
    } finally {
      await this.editorFontManager.ready();
      this.workspaceLoading = false;
      this.updateWorkspaceViewportVisibility();

      // During application startup the active tab is restored while the editor
      // is hidden behind the workspace loading state. A hidden CodeMirror scroll
      // container cannot reliably restore a non-zero scrollTop.
      //
      // Reapply the persisted viewport after the workspace becomes visible and
      // CodeMirror has had a chance to measure its final geometry.
      const activeTab = this.getActiveTab();
    
      if (
        activeTab &&
        (activeTab.scrollTop !== undefined || activeTab.scrollLeft !== undefined)
      ) {
        const activePath = activeTab.path;
        const targetScrollTop = activeTab.scrollTop ?? 0;
        const targetScrollLeft = activeTab.scrollLeft ?? 0;
    
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (
              !this.activeFilePath ||
              filePathKey(this.activeFilePath) !== filePathKey(activePath)
            ) {
              return;
            }
    
            this.editorInstance.requestMeasure();
    
            this.editorInstance.scrollDOM.scrollTop = targetScrollTop;
            this.editorInstance.scrollDOM.scrollLeft = targetScrollLeft;
    
            this.editorController.updateCaretMarker();
    
            this.appendDeveloperLog({
              kind: "info",
              source: "editor state",
              message:
                `Restored startup editor viewport: top=${targetScrollTop.toFixed(0)}, `
                + `left=${targetScrollLeft.toFixed(0)}`
            });
          });
        });
      }
    }
    void this.startWorkspaceServices(selected);
  }

  private async startWorkspaceServices(selected: string): Promise<void> {
    try {
      if (this.workspaceRootPath !== selected) return;
      if (this.workspaceServicesDeferredForLargeFile) return;
      if (
        this.pinnedMainFilePath
        && !await this.ensureLargePreviewApproved(this.pinnedMainFilePath)
      ) {
        return;
      }
      this.workspaceServicesDeferredForLargeFile = false;
      if (this.pinnedMainFilePath) {
        const typography = await this.preparePinnedMainTypography(this.pinnedMainFilePath);
        if (this.workspaceRootPath !== selected) return;
        if (typography === false) {
          await invoke<boolean>("clear_scaled_workspace_fonts", { workspaceRootPath: selected });
          this.pinnedMainFilePath = null;
          this.mainDocumentScripts = [];
          await this.saveWorkspaceState();
        } else if (typography) {
          this.editorToolbarController.synchronizeDocumentTypography(typography);
        }
      }
      await this.prepareRenderProjectIfNeeded();
      if (this.workspaceRootPath !== selected) return;
      if (this.lspClient) {
        try {
          await this.restartTinymistSession("Connecting to new project...");
          if (this.workspaceRootPath !== selected) return;
        } catch (error) {
          if (this.workspaceRootPath !== selected) return;
          this.lspReady = false;
          this.appendDeveloperLog({
            kind: "error",
            source: "lsp",
            message: `Failed to restart Tinymist for workspace ${selected}: ${String(error)}`
          });
        }
      }
      if (this.workspaceRootPath === selected && this.activeFilePath) {
        await this.restoreActiveDocumentAfterTinymistRestart();
      }
    } catch (error) {
      if (this.workspaceRootPath === selected) {
        this.appendDeveloperLog({
          kind: "error",
          source: "workspace",
          message: `Workspace services failed to start: ${String(error)}`
        });
      }
    }
  }

  private async restoreWorkspaceToolchain(metadata: WorkspaceMetadata): Promise<void> {
    this.recommendedWorkspaceToolchain = metadata.project.recommendedToolchain;
    this.selectedWorkspaceToolchain = metadata.workspace.selectedToolchain;
    if (!this.selectedWorkspaceToolchain) return;
    try {
      const status = await invoke<ToolchainStatus>("select_project_toolchain", {
        tinymistVersion: this.selectedWorkspaceToolchain.tinymistVersion,
        typstVersion: this.selectedWorkspaceToolchain.typstVersion
      });
      this.toolchainController.setStatus(status);
    } catch (error) {
      this.appendDeveloperLog({
        kind: "warning",
        source: "toolchain",
        message: `Could not restore this workspace's selected toolchain: ${String(error)}`
      });
    }
  }

  private importTypsastraProject(archivePath?: string): Promise<void> {
    return this.projectImportController.importProject(archivePath);
  }

  private async completeProjectImport(
    imported: ImportedTypsastraProject,
    projectName: string,
  ): Promise<boolean> {
    await this.openWorkspace(imported.workspacePath);
    const activeToolchain = await invoke<ToolchainStatus>("get_toolchain_status").catch(() => null);
    this.recommendedWorkspaceToolchain = {
      tinymistVersion: imported.manifest.toolchain.tinymistVersion,
      typstVersion: imported.manifest.toolchain.typstVersion,
    };
    this.selectedWorkspaceToolchain = activeToolchain?.tinymistVersion && activeToolchain.typstVersion
      ? {
          tinymistVersion: activeToolchain.tinymistVersion,
          typstVersion: activeToolchain.typstVersion,
        }
      : null;
    if (
      !this.workspaceRootPath
      || filePathKey(this.workspaceRootPath) !== filePathKey(imported.workspacePath)
    ) {
      return false;
    }
    await this.setPinnedMainFile(imported.mainFilePath);
    await this.saveWorkspaceState();
    this.setLspStatus({ kind: "preview-ready", message: `Imported ${projectName}` });
    return true;
  }
  private async closeOtherTabs(pathToKeep: string) {
    const tabsToClose = this.openTabs.filter(tab => tab.path !== pathToKeep);
    for (const tab of tabsToClose) {
      await this.closeEditorTab(tab.path, false);
    }
  }

  private async restartWorkspace() {
    if (this.workspaceRootPath) {
      const currentWorkspace = this.workspaceRootPath;
      await this.closeProject({ confirmUnsaved: false });
      await this.openWorkspace(currentWorkspace);
    }
  }

  private async openExamplesWorkspace(): Promise<void> {
    const button = document.getElementById("welcome-open-examples") as HTMLButtonElement | null;
    if (button) button.disabled = true;
    try {
      const examples = await invoke<ExamplesWorkspace>("prepare_examples_workspace");
      await this.openWorkspace(examples.workspacePath);
      await this.loadFile(examples.entryPath);
    } catch (error) {
      this.appendLspLog({
        kind: "error",
        source: "examples",
        message: `Failed to open examples: ${String(error)}`
      });
      await message(String(error), { title: "Unable to open examples", kind: "error" });
    } finally {
      if (button) button.disabled = false;
    }
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

      try {
        await this.prepareWorkspaceTypographyFont(typography);
      } finally {
        this.typographyFontUpdateInProgress = false;
        this.deferredTypographyPreviewContents = null;
      }
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
      this.sortPinnedMainTabFirst();
      this.renderEditorTabs();
      if (this.workspaceRootPath) {
        await this.explorer.loadWorkspace(this.workspaceRootPath);
      }
      return;
    }

    if (mainChanged && this.lspClient && previewApproved) {
      if (this.pdfPreviewTimer !== null) window.clearTimeout(this.pdfPreviewTimer);
      this.pdfPreviewTimer = null;
      this.pdfPreviewScheduleGeneration += 1;
      this.pdfPreparationRevision += 1;
      this.pdfPreviewGeneration += 1;
      this.queuedPdfPreviewContents = null;
      this.queuedPdfPreviewForced = false;
      void invoke("cancel_render_preparation").catch(() => {});
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
      this.sortPinnedMainTabFirst();
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

  private async closeProject(options: { confirmUnsaved?: boolean } = {}): Promise<boolean> {
    const confirmUnsaved = options.confirmUnsaved ?? true;
    if (confirmUnsaved && this.openTabs.some(tab => tab.isDirty)) {
      const shouldClose = await confirm(
        "Close this project with unsaved changes? The editor state will be kept for session recovery, but the files are not saved to disk.",
        { title: "Unsaved Changes", kind: "warning" }
      );
      if (!shouldClose) return false;
    }

    await this.saveWorkspaceState();
    this.workspaceController.stopWatching();

    const previewTaskIds = new Set([
      this.previewTaskId,
      this.pdfPreviewSourceMapTaskId,
      this.sourceMapSessionController.registeredTaskId
    ].filter((taskId): taskId is string => Boolean(taskId)));
    if (this.lspClient) {
      for (const taskId of previewTaskIds) {
        void this.lspClient.stopPreview(taskId).catch(() => {});
      }
    }

    try {
      await this.stopTinymistSession("Project closed");
    } catch (error) {
      this.appendDeveloperLog({
        kind: "warning",
        source: "lsp",
        message: `Tinymist did not stop cleanly while closing the project: ${String(error)}`
      });
    }

    if (this.pdfPreviewTimer !== null) window.clearTimeout(this.pdfPreviewTimer);
    if (this.typographyScaleCheckTimer !== null) window.clearTimeout(this.typographyScaleCheckTimer);
    this.pdfPreviewTimer = null;
    this.typographyScaleCheckTimer = null;
    this.typographyScaleCheckGeneration += 1;
    this.acceptedTypographyScales.clear();
    this.approvedLargePreviewRoots.clear();
    this.inspectedPreviewRoots.clear();
    this.blockedLargePreviewRoot = null;
    this.previewImageProfile = null;
    this.previewContentMode = "normal";
    this.presentedPreviewContentMode = "normal";
    this.previewScrollTop = 0;
    if (this.previewScrollSaveTimer !== null) window.clearTimeout(this.previewScrollSaveTimer);
    this.previewScrollSaveTimer = null;
    this.draftImageAssets.clear();
    this.draftImageDiagnostics = [];
    this.draftAssetRootPath = null;
    this.draftThumbnailDocumentRootPath = null;
    this.draftThumbnailGeneration = 0;
    void invoke("cancel_draft_thumbnail_generation").catch(() => {});
    this.updatePreviewContentModeControl();
    this.updateImageHeavyPreviewWarning(null);
    this.publishImageOptimizationWarnings(null);
    this.lastTypographyInternalScaleError = "";
    this.pdfPreviewGeneration += 1;
    this.previewSyncController.cancelManual();
    this.tinymistPreviewRecoveryAttempts = 0;
    this.tinymistPreviewRecovery = null;
    this.queuedPdfPreviewContents = null;
    this.queuedPdfPreviewForced = false;

    this.workspaceRootPath = null;
    this.sidebarController.reset();
    document.body.classList.remove("image-tools-active");
    void this.imageToolsController.setWorkspace(null, null);
    this.workspaceMetadata = null;
    this.settingsController.setWorkspacePreviewRenderMode(null);
    this.lastPreviewRenderMode = this.settingsController.value.preview.renderMode;
    this.workspaceLoading = false;
    this.recommendedWorkspaceToolchain = null;
    this.selectedWorkspaceToolchain = null;
    this.activeFilePath = null;
    this.explorer.setActiveFile(null);
    this.openTabs = [];
    this.pinnedMainFilePath = null;
    this.mainDocumentScripts = [];
    this.pinnedLspMainPath = null;
    this.previewRootPath = null;
    this.previewMainPath = null;
    this.previewTaskId = null;
    this.previewSessionKey = null;
    this.previewImported = false;
    this.previewStandalone = true;
    this.previewDisabled = false;
    this.pdfPreviewSourceMapRootPath = null;
    this.pdfPreviewSourceMapTaskId = null;
    this.pdfPreviewGeneratedFiles.clear();
    this.managedPreviewPdfPathKeys.clear();
    this.managedImageToolPathKeys.clear();
    this.sourceMapSessionController.reset();
    this.externalPreviewRefreshPending = false;
    this.lastPdfPath = "";
    this.lastPdfIdentity = "";
    this.lastPdfSessionKey = "";
    this.lastPdfSurface = "live";
    this.imagePreviewController.clear();
    this.updatePreviewActionsToolbar(null);

    this.openedDocumentUris.clear();
    this.externalConflictPaths.clear();
    this.clearPendingLspSync();
    this.previewSyncController.clearForward();
    this.clearDiagnostics();
    this.logConsoleController.clearAllLogs();
    this.logConsoleController.setVisible(false);

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
    this.activateSpellcheckDocument(null);
    this.editorFontManager.updateDocument("");
    this.editorToolbarController.setDisabled(true);
    if (this.activeMode === "WYSIWYM") this.mapMarkupToWysiwym("");
    
    // Clear workspace navigation
    this.explorer.clearWorkspace();
    this.documentOutlineController.clear();
    this.previewFrame.clear();
    this.renderEditorTabs();
    this.setLspStatus({ kind: "stopped", message: "Project closed" });
    this.updateWorkspaceViewportVisibility();
    return true;
  }

  private bindGlobalEvents() {
    installModalFocusTrap();
    window.addEventListener("typsastra-open-image-tool", event => {
      const imagePath = (event as CustomEvent<{ imagePath?: string }>).detail?.imagePath;
      if (imagePath) void this.navigateToImageTool(imagePath);
    });
    import("@tauri-apps/api/event").then(({ listen, emit }) => {
      listen("preview-window-ready", () => {
        if (this.lastPdfPath) {
          emit("pdf-update", {
            path: this.lastPdfPath,
            identity: this.lastPdfIdentity || this.pdfPreviewSourceMapRootPath || this.previewRootPath || "preview",
            sessionKey: this.lastPdfSessionKey || this.previewSessionKey || this.lastPdfIdentity || "preview",
            surface: this.lastPdfSurface,
            contentMode: this.presentedPreviewContentMode,
            draftAssets: this.presentedPreviewContentMode === "draft"
              ? [...this.draftImageAssets.values()]
              : [],
            draftAssetRootPath: this.presentedPreviewContentMode === "draft"
              ? this.draftAssetRootPath ?? undefined
              : undefined,
            draftThumbnailGeneration: this.presentedPreviewContentMode === "draft"
              ? this.draftThumbnailGeneration
              : undefined
          } satisfies PdfUpdatePayload);
        }
      });
      listen<PreviewContentMode>("preview-content-mode-request", event => {
        void this.setPreviewContentMode(event.payload);
      });
      listen<UndockedPreviewAction>("preview-window-action", event => {
        if (event.payload === "export-pdf") {
          document.getElementById("action-export-pdf")?.click();
        } else if (event.payload === "open-external" && this.lastPdfPath) {
          void this.openFileExternally(this.lastPdfPath);
        }
      });
      listen<PreviewClickPoint>("pdf-click", (event) => {
        const point = event.payload;
        void this.handlePdfPreviewClick(point);
      });
    }).catch(err => console.error("Error setting up Tauri preview event listeners", err));

    void listen("typsastra-project-open-requested", () => {
      void this.drainPendingProjectImports();
    });

    window.addEventListener("beforeunload", () => {
      this.systemResumeMonitor.stop();
      if (this.sourceMapSessionController.registeredTaskId && this.lspClient) {
        void this.lspClient.stopPreview(this.sourceMapSessionController.registeredTaskId).catch(() => {});
      }
      this.workspaceController.stopWatching();
      this.saveWorkspaceState();
      this.settingsController.flush();
    });

    document.addEventListener("keydown", (e) => {
      // Windows exposes AltGr as Ctrl+Alt. Let the WebView and CodeMirror
      // receive the event as text input before evaluating application or
      // browser-shortcut suppression rules.
      if (isAltGraphKeyboardEvent(e)) return;

      const isMac = navigator.userAgent.toLowerCase().includes("mac");
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      const keyCode = e.code;

      if (e.key === "Escape" && document.activeElement?.closest(".cm-editor")) {
        this.spellcheckController.dismissActiveTyping();
      }
      
      // Ctrl+F12 to open devtools in dev build
      if (cmdOrCtrl && keyCode === "F12" && import.meta.env.DEV) {
        e.preventDefault();
        void invoke("open_devtools");
      }

      if (e.altKey && !cmdOrCtrl && !e.shiftKey && keyCode === "Enter") {
        e.preventDefault();
        this.revealCursorInPreviewManually();
        return;
      }
      
      // Block common function keys (except F3 which we handle conditionally)
      if (["F5", "F6", "F7", "F11"].includes(keyCode)) {
        e.preventDefault();
      }
      
      // Block specific browser shortcuts (that we don't map below)
      if (cmdOrCtrl && ["KeyR", "KeyP", "KeyJ", "KeyU", "KeyD"].includes(keyCode)) {
        e.preventDefault();
      }
      
      // Block browser's Find/Replace shortcuts only if not in an input/textarea/editor
      if (keyCode === "F3" || (cmdOrCtrl && ["KeyF", "KeyG", "KeyH"].includes(keyCode))) {
         const active = document.activeElement;
         if (!active || (!active.classList.contains("cm-content") && active.tagName !== "INPUT" && active.tagName !== "TEXTAREA" && !active.closest('.cm-panel'))) {
             e.preventDefault();
         }
      }
      
      if (cmdOrCtrl && e.shiftKey && ["KeyI", "KeyC", "KeyF", "KeyJ", "KeyR"].includes(keyCode)) {
        e.preventDefault();
      }

      if (cmdOrCtrl && e.shiftKey && !e.altKey && keyCode === "KeyF") {
        e.preventDefault();
        void this.formatActiveDocument();
        return;
      }

      if (cmdOrCtrl && e.shiftKey && !e.altKey && keyCode === "KeyS") {
        e.preventDefault();
        void this.saveActiveFileAs();
        return;
      }

      const recentProjectIndex = recentProjectShortcutIndex(e);
      const welcomeScreen = document.getElementById("welcome-screen");
      if (
        recentProjectIndex !== null
        && welcomeScreen
        && !welcomeScreen.classList.contains("hidden")
        && this.recentProjectsController.openAt(recentProjectIndex)
      ) {
        e.preventDefault();
        return;
      }
      
      // App Keymappings
      if (cmdOrCtrl && !e.shiftKey && !e.altKey) {
        switch (keyCode) {
          case "KeyS":
            e.preventDefault();
            void this.saveActiveFile();
            break;
          case "KeyO":
            e.preventDefault();
            document.getElementById("action-open-folder")?.click();
            break;
          case "KeyN":
            e.preventDefault();
            document.getElementById("action-new-file")?.click();
            break;
          case "KeyB":
            e.preventDefault();
            document.getElementById("action-toggle-sidebar")?.click();
            break;
          case "KeyE":
            e.preventDefault();
            document.getElementById("action-export-pdf")?.click();
            break;
          case "KeyQ":
            e.preventDefault();
            document.getElementById("action-exit")?.click();
            break;
          case "Backquote":
            e.preventDefault();
            document.getElementById("action-toggle-logs")?.click();
            break;
        }
      }

      if (e.altKey && !cmdOrCtrl && !e.shiftKey) {
        if (keyCode === "KeyZ") {
          e.preventDefault();
          document.getElementById("action-toggle-word-wrap")?.click();
        }
      }
    });

    // TODO: Re-enable native WYSIWYM layout events when the implementation is ready.
    // listen("menu-toggle-layout", () => this.switchViewLayoutMode());
    listen("menu-toggle-log-console", () => this.logConsoleController.toggle());
    listen("menu-open-folder", async () => {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await this.openWorkspace(selected);
      }
    });

    document.getElementById("preview-zoom-out-btn")?.addEventListener("click", () => {
      this.zoomOut();
    });

    document.getElementById("preview-zoom-in-btn")?.addEventListener("click", () => {
      this.zoomIn();
    });

    document.getElementById("preview-zoom-fit-btn")?.addEventListener("click", () => {
      this.zoomToFit();
    });

    document.getElementById("preview-recompile-btn")?.addEventListener("click", () => {
      this.recompilePreviewManually();
    });

    document.getElementById("preview-image-warning-btn")?.addEventListener("click", () => {
      void this.showImageHeavyPreviewDetails();
    });
    document.getElementById("preview-content-mode-toggle")?.addEventListener("click", () => {
      void this.setPreviewContentMode(this.previewContentMode === "draft" ? "normal" : "draft");
    });

    const previewForwardSyncButton = document.getElementById("preview-forward-sync-btn");
    previewForwardSyncButton?.addEventListener("pointerdown", event => {
      if (event.button === 0 && this.editorInstance.hasFocus) event.preventDefault();
    });
    previewForwardSyncButton?.addEventListener("click", () => {
      this.revealCursorInPreviewManually();
    });

    this.initializePreviewPageControls();
    this.updatePreviewZoomLabel();
    this.updateManualForwardSyncAction();

    document.getElementById("action-open-folder")?.addEventListener("click", async () => {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await this.openWorkspace(selected);
      }
    });

    document.getElementById("action-import-project")?.addEventListener("click", async () => {
      await this.importTypsastraProject();
    });
    
    document.getElementById("action-restart-workspace")?.addEventListener("click", () => {
      void this.restartWorkspace();
    });

    document.getElementById("action-close-project")?.addEventListener("click", () => {
      void this.closeProject();
    });

    document.getElementById("action-new-file")?.addEventListener("click", async () => {
      if (!this.workspaceRootPath) {
        alert("Please open a project first.");
        return;
      }
      const savePath = await save({
        defaultPath: this.workspaceRootPath,
        filters: [{ name: "Typst Document", extensions: ["typ"] }]
      });
      if (typeof savePath === "string") {
        await invoke("save_workspace_file", { path: savePath, contents: "= New Document\n" });
        this.explorer.loadWorkspace(this.workspaceRootPath);
        this.loadFile(savePath);
      }
    });

    document.getElementById("action-save-file")?.addEventListener("click", async () => {
      await this.saveActiveFile();
    });

    document.getElementById("action-save-file-as")?.addEventListener("click", async () => {
      await this.saveActiveFileAs();
    });

    document.getElementById("action-export-pdf")?.addEventListener("click", async () => {
      if (this.activeFilePath) {
        const content = this.editorInstance.state.doc.toString();
        this.exportInProgress = true;
        try {
          const rootPath = this.previewStandalone
            ? (this.previewRootPath ?? this.activeFilePath)
            : (this.previewMainPath ?? this.previewRootPath ?? this.activeFilePath);
          
          if (!rootPath) throw new Error("No export root path available");

          const defaultPdfPath = (this.previewStandalone
            ? this.activeFilePath
            : (this.previewMainPath ?? this.activeFilePath)).replace(/\.typ$/i, ".pdf");
          const exportPdfPath = await save({
            title: "Export PDF",
            defaultPath: defaultPdfPath,
            filters: [{ name: "PDF Document", extensions: ["pdf"] }]
          });
          if (!exportPdfPath) {
            this.setLspStatus({ kind: "preview-ready", message: "PDF export cancelled" });
            return;
          }

          this.setLspStatus({ kind: "running", message: "Exporting PDF..." });
          let targetFilePath = rootPath;
          let targetContent = "";
          if (filePathKey(targetFilePath) === filePathKey(this.activeFilePath)) {
            targetContent = content;
          } else {
            targetContent = await invoke<string>("read_workspace_file", { path: targetFilePath }).catch(() => "");
          }

          const cacheRoot = this.getCacheRootPath();
          if (cacheRoot && this.workspaceRootPath) {
            const originalRootPath = this.mapToOriginalPath(rootPath);
            const originalActivePath = this.mapToOriginalPath(this.activeFilePath);
            
            const options = {
              enableKhmerZws: this.settingsController.value.preview.khmerRenderPreparation,
              projectRoot: this.workspaceRootPath,
              entryFile: originalRootPath,
              cacheRoot,
              generateSourceMap: false,
              // User-facing export must never compile Draft Preview placeholders.
              previewContentMode: "normal"
            };

            const result = await invoke<{ generatedEntryFile: string }>("prepare_render_project", { options });
            
            const tabsToOverlay = this.openTabs
              .filter(tab => tab.contentLoaded)
              .filter(tab => tab.path.toLowerCase().endsWith(".typ"))
              .filter(tab => this.workspaceRootPath && relativeFilePath(this.workspaceRootPath, this.mapToOriginalPath(tab.path)) !== null);
            
            for (const tab of tabsToOverlay) {
              const originalTabPath = this.mapToOriginalPath(tab.path);
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
            filePath: targetFilePath
          });
          
          await invoke("copy_workspace_file", { source: pdfPath, dest: exportPdfPath });
          await invoke("move_to_trash", { path: pdfPath });
          
          this.setLspStatus({ kind: "preview-ready", message: `Exported to ${exportPdfPath}` });
        } catch (error) {
          this.setLspStatus({ kind: "error", message: `Export failed: ${error}` });
        } finally {
          this.exportInProgress = false;
        }
      }
    });

    document.getElementById("action-export-project")?.addEventListener("click", async () => {
      if (!this.workspaceRootPath) {
        alert("Please open a project first.");
        return;
      }
      if (this.openTabs.some(tab => tab.isDirty)) {
        await message("Save all modified files before exporting so the archive matches the editor.", {
          title: "Unsaved Files",
          kind: "warning"
        });
        return;
      }

      const mainFilePath = this.previewMainPath ?? (
        this.activeFilePath?.toLowerCase().endsWith(".typ") ? this.activeFilePath : null
      );
      if (!mainFilePath) {
        await message("Set or open the project's main Typst file before exporting a version-bound project.", {
          title: "Main File Required",
          kind: "warning"
        });
        return;
      }

      this.exportInProgress = true;
      try {
        const folderName = this.workspaceRootPath.split(/[/\\]/).pop() || "workspace";
        const selected = await save({
          filters: [{
            name: "Typsastra Project",
            extensions: ["typsastra"]
          }],
          defaultPath: `${folderName}.typsastra`
        });

        if (selected) {
          this.setLspStatus({ kind: "running", message: "Exporting Typsastra project..." });
          await invoke("export_typsastra_project", {
            workspacePath: this.workspaceRootPath,
            archivePath: selected,
            mainFilePath
          });
          this.setLspStatus({
            kind: "preview-ready",
            message: `Typsastra project exported to ${selected}. Font files were not included.`
          });
        }
      } catch (error) {
        this.setLspStatus({ kind: "error", message: `Project export failed: ${error}` });
        await message(String(error), { title: "Typsastra Project Export Failed", kind: "error" });
      } finally {
        this.exportInProgress = false;
      }
    });

    document.getElementById("action-export-source-zip")?.addEventListener("click", async () => {
      if (!this.workspaceRootPath) {
        alert("Please open a project first.");
        return;
      }
      if (this.openTabs.some(tab => tab.isDirty)) {
        await message("Save all modified files before exporting so the ZIP matches the editor.", {
          title: "Unsaved Files",
          kind: "warning"
        });
        return;
      }

      this.exportInProgress = true;
      try {
        const folderName = this.workspaceRootPath.split(/[/\\]/).pop() || "workspace";
        const selected = await save({
          filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
          defaultPath: `${folderName}.zip`
        });
        if (selected) {
          this.setLspStatus({ kind: "running", message: "Exporting source ZIP..." });
          await invoke("export_source_zip", {
            workspacePath: this.workspaceRootPath,
            zipPath: selected
          });
          this.setLspStatus({
            kind: "preview-ready",
            message: `Source ZIP exported to ${selected}. Font files were not included.`
          });
        }
      } catch (error) {
        this.setLspStatus({ kind: "error", message: `Source ZIP export failed: ${error}` });
        await message(String(error), { title: "Source ZIP Export Failed", kind: "error" });
      } finally {
        this.exportInProgress = false;
      }
    });

    document.getElementById("action-exit")?.addEventListener("click", () => {
      getCurrentWindow().close();
    });

    document.getElementById("action-undo")?.addEventListener("click", () => {
      undo({ state: this.editorInstance.state, dispatch: this.editorInstance.dispatch });
    });

    document.getElementById("action-redo")?.addEventListener("click", () => {
      redo({ state: this.editorInstance.state, dispatch: this.editorInstance.dispatch });
    });

    document.getElementById("action-format-document")?.addEventListener("click", () => {
      void this.formatActiveDocument();
    });

    document.getElementById("action-fold-file")?.addEventListener("click", () => {
      this.foldCurrentFile();
    });

    document.getElementById("action-unfold-file")?.addEventListener("click", () => {
      this.unfoldCurrentFile();
    });

    document.getElementById("action-toggle-word-wrap")?.addEventListener("click", () => {
      document.getElementById("word-wrap-toggle")?.click();
    });

    document.getElementById("action-toggle-sidebar")?.addEventListener("click", () => {
      this.sidebarController.toggle();
    });

    document.getElementById("sidebar-toggle-button")?.addEventListener("click", () => {
      this.sidebarController.toggle();
    });

    document.getElementById("sidebar-explorer-button")?.addEventListener("click", () => {
      this.sidebarController.setTool("explorer");
    });

    document.getElementById("sidebar-images-button")?.addEventListener("click", () => {
      this.sidebarController.setTool("images");
    });

    document.getElementById("action-restore-default-layout")?.addEventListener("click", () => {
      this.restoreDefaultLayout();
    });

    document.getElementById("action-clear-logs")?.addEventListener("click", () => {
      this.logConsoleController.clearLogs();
    });

    document.getElementById("action-restart-lsp")?.addEventListener("click", async () => {
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
      // Re-register the existing in-memory document with Tinymist without
      // replacing CodeMirror's EditorState. The editor parser, selection,
      // viewport, and undo history are independent of the LSP lifecycle.
      await this.restoreActiveDocumentAfterTinymistRestart();
    });

    document.getElementById("action-docs-typsastra")?.addEventListener("click", () => {
      openUrl("https://github.com/sovichea/typsastra");
    });

    document.getElementById("action-docs-typst")?.addEventListener("click", () => {
      openUrl("https://typst.app/docs");
    });

    const aboutOverlay = document.getElementById("about-overlay");
    const aboutClose = document.getElementById("about-close") as HTMLButtonElement | null;
    const aboutAction = document.getElementById("action-about-typsastra") as HTMLElement | null;
    const closeAbout = () => {
      if (aboutOverlay?.classList.contains("hidden")) return;
      aboutOverlay?.classList.add("hidden");
      aboutAction?.focus();
    };
    aboutAction?.addEventListener("click", async () => {
      const version = document.getElementById("about-version");
      if (version) version.textContent = await getVersion().catch(() => "Unavailable");
      aboutOverlay?.classList.remove("hidden");
      aboutClose?.focus();
    });
    aboutClose?.addEventListener("click", closeAbout);
    document.getElementById("about-done")?.addEventListener("click", closeAbout);
    document.getElementById("about-project-page")?.addEventListener("click", () => {
      openUrl("https://github.com/Sovichea/typsastra");
    });
    aboutOverlay?.addEventListener("click", event => {
      if (event.target === aboutOverlay) closeAbout();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !aboutOverlay?.classList.contains("hidden")) closeAbout();
    });

    // TODO: Re-enable the WYSIWYM layout menu action when the implementation is ready.
    // document.getElementById("action-toggle-layout")?.addEventListener("click", () => this.switchViewLayoutMode());
    document.getElementById("action-toggle-logs")?.addEventListener("click", () => this.logConsoleController.toggle());

    // Welcome Screen Actions
    const welcomeScreen = document.getElementById("welcome-screen");
    if (welcomeScreen) installWelcomeKeyboardNavigation(welcomeScreen);
    document.getElementById("welcome-open-project")?.addEventListener("click", () => {
      document.getElementById("action-open-folder")?.click();
    });
    document.getElementById("welcome-import-project")?.addEventListener("click", () => {
      document.getElementById("action-import-project")?.click();
    });
    document.getElementById("welcome-open-examples")?.addEventListener("click", () => {
      void this.openExamplesWorkspace();
    });

    // Menu Bar Dropdown logic
    const dropdownContainers = document.querySelectorAll("#app-menus .dropdown-container");
    dropdownContainers.forEach(container => {
      container.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        
        // If the user clicked a dropdown action item, close all menus and do not toggle open
        if (target.closest(".dropdown-item")) {
          dropdownContainers.forEach(c => c.classList.remove("active"));
          return;
        }

        const isActive = container.classList.contains("active");
        // Close all dropdowns
        dropdownContainers.forEach(c => c.classList.remove("active"));
        if (!isActive) {
          container.classList.add("active");
        }
        e.stopPropagation();
      });

      container.addEventListener("mouseenter", () => {
        // If any dropdown is already active, open this one on hover
        const isAnyActive = Array.from(dropdownContainers).some(c => c.classList.contains("active"));
        if (isAnyActive && !container.classList.contains("active")) {
          dropdownContainers.forEach(c => c.classList.remove("active"));
          container.classList.add("active");
        }
      });
    });

    // Close on outside click
    document.addEventListener("click", () => {
      dropdownContainers.forEach(c => c.classList.remove("active"));
    });

    const appWindow = getCurrentWindow();
    document.getElementById("titlebar-minimize")?.addEventListener("click", () => appWindow.minimize());
    document.getElementById("titlebar-maximize")?.addEventListener("click", () => appWindow.toggleMaximize());

    void appWindow.onResized(async () => {
      const maximized = await appWindow.isMaximized();
      updateMaximizeIcon(maximized);
    });
    void this.windowStateController.start().catch(error => {
      console.warn("Failed to monitor the main window state:", error);
    });
    void appWindow.isMaximized().then(maximized => updateMaximizeIcon(maximized));
    document.getElementById("titlebar-close")?.addEventListener("click", () => appWindow.close());

    let closeRequestInProgress = false;
    void appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      if (closeRequestInProgress) return;
      closeRequestInProgress = true;
      const hasUnsaved = this.openTabs.some(tab => tab.isDirty);
      let proceed = true;
      if (hasUnsaved) {
        proceed = await confirm(
          "You have unsaved changes. Are you sure you want to close Typsastra?",
          {
            title: "Unsaved Changes",
            kind: "warning",
            okLabel: "Close Without Saving",
            cancelLabel: "Cancel"
          }
        );
      }
      if (proceed) proceed = await this.appUpdateController.prepareForClose();
      if (proceed) {
        await this.windowStateController.persistNow();
        try {
          const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
          const previewWin = await WebviewWindow.getByLabel("preview");
          if (previewWin) {
            await previewWin.close();
          }
        } catch (e) {
          console.error("Failed to close preview window on exit:", e);
        }
        void appWindow.destroy();
        return;
      }
      closeRequestInProgress = false;
    });

    this.wysiwymContainer.addEventListener("input", () => {
      if (this.activeMode === "WYSIWYM") {
        const generatedMarkup = this.mapWysiwymToMarkup();
        this.handleContentMutation(generatedMarkup);
      }
    });

    this.wysiwymContainer.addEventListener("click", async (ev) => {
      const e = ev as MouseEvent;
      if (e.ctrlKey) {
        const target = e.target as HTMLElement;
        const linkSpan = target.closest(".wysiwym-link");
        if (linkSpan) {
          const url = linkSpan.getAttribute("data-url");
          if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
            const trust = window.confirm(`Do you want to open this external link in your browser?\n\n${url}`);
            if (trust) {
              try {
                await openUrl(url);
              } catch (err) {
                console.error("Failed to open URL", err);
              }
            }
          }
        }
      }
    });

    this.previewPane.addEventListener("click", (e) => {
      const target = e.target as Element;
      // Typst compiler often outputs 'data-source' or 'data-typst-source' containing line mapping
      const srcElement = target.closest("[data-source], [data-typst-source]");
      if (srcElement) {
        const source = srcElement.getAttribute("data-source") || srcElement.getAttribute("data-typst-source");
        if (source) {
          const parts = source.split(":");
          if (parts.length >= 3) {
            try {
              const line = parseInt(parts[parts.length - 2], 10);
              const column = parseInt(parts[parts.length - 1], 10);
              const cursor = this.editorPositionFromSourceLocation(line, column);
              if (this.activeMode === "WYSIWYM") {
                this.switchViewLayoutMode(); // auto switch to code mode to show the line
              }
              this.previewSyncController.suppressOnce();
              this.editorInstance.dispatch({
                selection: { anchor: cursor },
                scrollIntoView: true
              });
              this.editorInstance.focus();
              void this.previewSyncController.renderAtCursor(cursor);
            } catch (err) { console.warn("Failed to inverse sync:", err); }
          }
        }
      }
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
    const key = filePathKey(originalPath);
    const cached = this.pdfPreviewGeneratedFiles.get(key);
    if (cached) return cached.preparedText;
    if (!this.workspaceRootPath) return "";
    const relativePath = relativeFilePath(this.workspaceRootPath, originalPath);
    if (relativePath === null) return "";
    const cacheRoot = this.getCacheRootPath();
    if (!cacheRoot) return "";
    const generatedPath = `${cacheRoot}/render/${relativePath.replace(/\\/g, "/")}`;
    try {
      const preparedText = normalizeEditorText(await invoke<string>("read_workspace_file", { path: generatedPath }));
      this.pdfPreviewGeneratedFiles.set(key, { generatedPath, preparedText });
      return preparedText;
    } catch {
      return "";
    }
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



  private async prepareRenderProjectIfNeeded(): Promise<void> {
    if (!this.workspaceRootPath || !this.pinnedMainFilePath) return;
    const cacheRoot = this.getCacheRootPath();
    if (!cacheRoot) return;

    // Cache preparation is shared by render-on-save and render-on-type. Their
    // only difference is the trigger: explicit save versus debounced input.
    // Always mirror the configured main document, never whichever dependency
    // happens to be active while the workspace or LSP is starting.
    const entryFile = this.mapToOriginalPath(this.pinnedMainFilePath);

    try {
      await invoke("prepare_render_project", {
        options: {
          enableKhmerZws: this.settingsController.value.preview.khmerRenderPreparation,
          projectRoot: this.workspaceRootPath,
          entryFile,
          cacheRoot,
          generateSourceMap: true,
          previewContentMode: "normal"
        }
      });
    } catch (e) {
      console.error("Failed to prepare render project:", e);
    }
  }

}

function nextAnimationFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}
