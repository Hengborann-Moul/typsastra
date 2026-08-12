import { filePathKey } from "../platform/paths";
import type { EditorTab } from "./editorTab";

export class EditorSessionController {
  private readonly openTabsValue: EditorTab[] = [];
  private activePathValue: string | null = null;

  get tabs(): EditorTab[] {
    return this.openTabsValue;
  }

  replaceTabs(tabs: EditorTab[]): void {
    this.openTabsValue.splice(0, this.openTabsValue.length, ...tabs);
  }

  get activeFilePath(): string | null {
    return this.activePathValue;
  }

  set activeFilePath(path: string | null) {
    this.activePathValue = path;
  }

  get activeTab(): EditorTab | null {
    if (!this.activePathValue) return null;
    const activeKey = filePathKey(this.activePathValue);
    return this.openTabsValue.find(tab => filePathKey(tab.path) === activeKey) ?? null;
  }

  sortPinnedMainFirst(pinnedMainFilePath: string | null): void {
    if (!pinnedMainFilePath) return;
    const pinnedKey = filePathKey(pinnedMainFilePath);
    const index = this.openTabsValue.findIndex(tab => filePathKey(tab.path) === pinnedKey);
    if (index <= 0) return;
    const [pinnedTab] = this.openTabsValue.splice(index, 1);
    pinnedTab.temporary = false;
    this.openTabsValue.unshift(pinnedTab);
  }
}
