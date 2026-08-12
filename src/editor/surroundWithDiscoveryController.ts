import { join } from "@tauri-apps/api/path";
import type { TinymistLspClient } from "../compiler/lsp";
import { filePathToUri } from "../platform/paths";
import {
  mergeDiscoveredSurroundWithOptions,
  SURROUND_WITH_OPTIONS,
  type SurroundWithCompletionItem,
  type SurroundWithOption,
} from "./surroundWith";

export interface SurroundWithDiscoveryDependencies {
  client(): TinymistLspClient | null;
  workspaceRootPath(): string | null;
  ready(): boolean;
  appendLog(kind: "info" | "warning", message: string): void;
}

/** Owns Tinymist-backed discovery of additional Surround With completion functions. */
export class SurroundWithDiscoveryController {
  private optionsValue: readonly SurroundWithOption[] = SURROUND_WITH_OPTIONS;
  private generation = 0;

  constructor(private readonly dependencies: SurroundWithDiscoveryDependencies) {}

  get options(): readonly SurroundWithOption[] {
    return this.optionsValue;
  }

  reset(): void {
    this.generation += 1;
    this.optionsValue = SURROUND_WITH_OPTIONS;
  }

  async discover(): Promise<void> {
    const client = this.dependencies.client();
    const workspaceRoot = this.dependencies.workspaceRootPath();
    const generation = ++this.generation;
    this.optionsValue = SURROUND_WITH_OPTIONS;
    if (!client || !workspaceRoot || !this.dependencies.ready()) return;

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
      if (generation !== this.generation || client !== this.dependencies.client()) return;
      const items = Array.isArray(response) ? response : response?.items ?? [];
      this.optionsValue = mergeDiscoveredSurroundWithOptions(items);
      this.dependencies.appendLog(
        "info",
        `Discovered ${this.optionsValue.length - SURROUND_WITH_OPTIONS.length} additional bracket-capable Surround With function(s).`,
      );
    } catch (error) {
      if (generation !== this.generation) return;
      this.dependencies.appendLog(
        "warning",
        `Using built-in Surround With functions because Tinymist discovery failed: ${String(error)}`,
      );
    } finally {
      await client.closeTextDocument(uri).catch(() => {});
    }
  }
}
