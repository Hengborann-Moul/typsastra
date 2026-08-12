import { describe, expect, test } from "bun:test";
import { EditorSessionController } from "../src/editor/editorSessionController";
import { WorkspaceResumeController } from "../src/platform/workspaceResumeController";
import type { EditorTab } from "../src/editor/editorTab";

function tab(path: string, temporary = false): EditorTab {
  return {
    path,
    content: "",
    savedContent: "",
    contentLoaded: true,
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
    temporary,
  };
}

describe("extracted controller behavior", () => {
  test("keeps editor-session tab identity and promotes the pinned main tab", () => {
    const controller = new EditorSessionController();
    const first = tab("C:/project/chapter.typ");
    const main = tab("C:/project/main.typ", true);
    controller.replaceTabs([first, main]);
    controller.activeFilePath = "c:\\PROJECT\\MAIN.TYP";

    expect(controller.activeTab).toBe(main);
    controller.sortPinnedMainFirst("C:/project/main.typ");
    expect(controller.tabs).toEqual([main, first]);
    expect(main.temporary).toBe(false);
  });

  test("blocks interaction during resize and releases all waiters at the boundary", async () => {
    const calls: string[] = [];
    const controller = new WorkspaceResumeController({
      canDeferWordWrap: () => true,
      disableWordWrap: () => calls.push("disable-wrap"),
      restoreWordWrap: () => calls.push("restore-wrap"),
      suspendPreviewResize: () => calls.push("suspend-preview"),
      resumePreviewResize: () => calls.push("resume-preview"),
      recoverInterruptedResize: () => false,
      hasActiveWorkspaceDocument: () => false,
      cancelManualForwardSync: () => {},
      resetSourceMap: () => {},
      restoreEditorFonts: async () => {},
      rehydratePreviewAndSidebar: () => {},
      remeasureWorkspace: () => {},
      canWarmSourceMap: () => false,
      warmSourceMap: () => {},
      log: () => {},
    });

    controller.beginHorizontalResize();
    expect(controller.interactionBlocked).toBe(true);
    const released = controller.waitForHorizontalResizeEnd();
    controller.endHorizontalResize();
    await released;

    expect(controller.interactionBlocked).toBe(false);
    expect(calls).toEqual([
      "suspend-preview",
      "disable-wrap",
      "restore-wrap",
      "resume-preview",
    ]);
  });
});
