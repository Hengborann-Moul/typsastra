import type { TinymistLspClient } from "../compiler/lsp";

export interface DocumentSessionControllerPort {
  createClient(): TinymistLspClient;
  resetSessionState(): void;
  onConnected(): void | Promise<void>;
  onRestarted(): void | Promise<void>;
  setStoppedStatus(message: string): void;
  setStartingStatus(message: string): void;
  logLifecycle(message: string): void;
  logConnectionFailure(error: unknown): void;
}

export interface PendingDocumentSync {
  path: string;
  text: string;
  version: number | null;
  requestKey: string;
  generation: number;
}

/**
 * Owns the Tinymist process session and serializes lifecycle transitions.
 *
 * Document restoration, diagnostics, and preview/source-map cleanup remain
 * supplied through the port because they are application policies rather than
 * responsibilities of the compiler process session itself.
 */
export class DocumentSessionController {
  private clientValue!: TinymistLspClient;
  private readyValue = false;
  private lifecycleQueue: Promise<void> = Promise.resolve();
  private restartSequence = 0;
  private pendingSyncTimer: number | null = null;
  private pendingSyncPath: string | null = null;
  private pendingSyncText: string | null = null;
  private pendingSyncVersion: number | null = null;
  private readonly syncRequestGenerations = new Map<string, number>();

  constructor(private readonly port: DocumentSessionControllerPort) {}

  get client(): TinymistLspClient {
    return this.clientValue;
  }

  get hasClient(): boolean {
    return !!this.clientValue;
  }

  get ready(): boolean {
    return this.readyValue;
  }

  setReady(ready: boolean): void {
    this.readyValue = ready;
  }

  get hasPendingSync(): boolean {
    return this.pendingSyncPath !== null && this.pendingSyncText !== null;
  }

  queueDocumentSync(
    path: string,
    text: string,
    version: number,
    delayMs: number,
    flush: () => void,
  ): void {
    this.pendingSyncPath = path;
    this.pendingSyncText = text;
    this.pendingSyncVersion = version;
    if (this.pendingSyncTimer !== null) window.clearTimeout(this.pendingSyncTimer);
    this.pendingSyncTimer = window.setTimeout(() => {
      this.pendingSyncTimer = null;
      flush();
    }, delayMs);
  }

  takePendingSync(pathKey: (path: string) => string): PendingDocumentSync | null {
    this.cancelPendingSyncTimer();
    if (this.pendingSyncPath === null || this.pendingSyncText === null) return null;

    const path = this.pendingSyncPath;
    const requestKey = pathKey(path);
    const generation = (this.syncRequestGenerations.get(requestKey) ?? 0) + 1;
    this.syncRequestGenerations.set(requestKey, generation);
    const pending = {
      path,
      text: this.pendingSyncText,
      version: this.pendingSyncVersion,
      requestKey,
      generation,
    };
    this.pendingSyncPath = null;
    this.pendingSyncText = null;
    this.pendingSyncVersion = null;
    return pending;
  }

  isSyncRequestCurrent(requestKey: string, generation: number): boolean {
    return this.syncRequestGenerations.get(requestKey) === generation;
  }

  hasNewerPendingSync(path: string, version: number, pathKey: (path: string) => string): boolean {
    return this.pendingSyncPath !== null
      && pathKey(this.pendingSyncPath) === pathKey(path)
      && this.pendingSyncVersion !== null
      && this.pendingSyncVersion > version;
  }

  hasPendingSyncFor(path: string, pathKey: (path: string) => string): boolean {
    return this.pendingSyncPath !== null && pathKey(this.pendingSyncPath) === pathKey(path);
  }

  remapPendingSyncPath(remap: (path: string) => string): void {
    if (this.pendingSyncPath !== null) this.pendingSyncPath = remap(this.pendingSyncPath);
  }

  clearPendingSync(): void {
    this.cancelPendingSyncTimer();
    this.pendingSyncPath = null;
    this.pendingSyncText = null;
    this.pendingSyncVersion = null;
  }

  ensureClient(): TinymistLspClient {
    if (!this.clientValue) this.clientValue = this.port.createClient();
    return this.clientValue;
  }

  async initialize(shouldConnect = true): Promise<void> {
    const client = this.ensureClient();
    if (!shouldConnect) {
      this.readyValue = false;
      this.port.setStoppedStatus("Compiler preview (LSP unavailable)");
      return;
    }

    try {
      await client.connect();
      this.readyValue = true;
      await this.port.onConnected();
    } catch (error) {
      this.readyValue = false;
      this.port.logConnectionFailure(error);
    }
  }

  stop(statusMessage: string): Promise<void> {
    return this.runExclusive(async () => {
      this.readyValue = false;
      this.port.resetSessionState();
      if (this.clientValue) await this.clientValue.stop();
      this.port.setStoppedStatus(statusMessage);
    });
  }

  restart(statusMessage: string): Promise<void> {
    return this.runExclusive(async () => {
      const sequence = ++this.restartSequence;
      this.port.logLifecycle(`Tinymist restart ${sequence} requested: ${statusMessage}`);
      this.readyValue = false;
      this.port.resetSessionState();
      this.port.setStartingStatus(statusMessage);

      if (!this.clientValue) {
        await this.initialize();
        this.port.logLifecycle(
          `Tinymist restart ${sequence} completed through LSP initialization.`,
        );
        return;
      }

      await this.clientValue.restart();
      this.readyValue = true;
      await this.port.onRestarted();
      this.port.logLifecycle(`Tinymist restart ${sequence} completed.`);
    });
  }

  runExclusive(operation: () => Promise<void>): Promise<void> {
    const next = this.lifecycleQueue.then(operation, operation);
    this.lifecycleQueue = next.catch(() => {});
    return next;
  }

  private cancelPendingSyncTimer(): void {
    if (this.pendingSyncTimer !== null) window.clearTimeout(this.pendingSyncTimer);
    this.pendingSyncTimer = null;
  }
}
