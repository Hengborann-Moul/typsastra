import {
  PhysicalPosition,
  PhysicalSize,
  availableMonitors,
  type Window
} from "@tauri-apps/api/window";

const WINDOW_STATE_KEY = "typsastra.main-window-state.v1";
const CAPTURE_DELAY_MS = 150;
const MIN_WINDOW_WIDTH = 640;
const MIN_WINDOW_HEIGHT = 480;
const MIN_VISIBLE_EDGE = 96;

export type PersistedWindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
};

type MonitorBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

export function parsePersistedWindowState(value: string | null): PersistedWindowState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PersistedWindowState>;
    const x = finiteInteger(parsed.x);
    const y = finiteInteger(parsed.y);
    const width = finiteInteger(parsed.width);
    const height = finiteInteger(parsed.height);
    if (x === null || y === null || width === null || height === null
      || width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT
      || typeof parsed.maximized !== "boolean") return null;
    return { x, y, width, height, maximized: parsed.maximized };
  } catch {
    return null;
  }
}

export function windowBoundsAreVisible(
  state: PersistedWindowState,
  monitors: MonitorBounds[]
): boolean {
  return monitors.some(monitor => {
    const overlapWidth = Math.min(state.x + state.width, monitor.x + monitor.width)
      - Math.max(state.x, monitor.x);
    const overlapHeight = Math.min(state.y + state.height, monitor.y + monitor.height)
      - Math.max(state.y, monitor.y);
    return overlapWidth >= MIN_VISIBLE_EDGE && overlapHeight >= MIN_VISIBLE_EDGE;
  });
}

export class WindowStateController {
  private captureTimer: number | null = null;
  private normalBounds: Omit<PersistedWindowState, "maximized"> | null = null;
  private unlisten: Array<() => void> = [];

  constructor(private readonly window: Window) {}

  public async restore(): Promise<void> {
    const state = parsePersistedWindowState(localStorage.getItem(WINDOW_STATE_KEY));
    if (!state) return;

    const monitors = (await availableMonitors()).map(monitor => ({
      x: monitor.position.x,
      y: monitor.position.y,
      width: monitor.size.width,
      height: monitor.size.height
    }));
    if (!windowBoundsAreVisible(state, monitors)) return;

    this.normalBounds = {
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height
    };
    await this.window.setSize(new PhysicalSize(state.width, state.height));
    await this.window.setPosition(new PhysicalPosition(state.x, state.y));
    if (state.maximized) await this.window.maximize();
  }

  public async start(): Promise<void> {
    this.unlisten.push(await this.window.onMoved(() => this.scheduleCapture()));
    this.unlisten.push(await this.window.onResized(() => this.scheduleCapture()));
    // Seed normal bounds even if the user maximizes before the first move or
    // resize event is emitted.
    await this.capture();
  }

  public async persistNow(): Promise<void> {
    if (this.captureTimer !== null) {
      window.clearTimeout(this.captureTimer);
      this.captureTimer = null;
    }
    await this.capture();
  }

  public destroy(): void {
    if (this.captureTimer !== null) window.clearTimeout(this.captureTimer);
    this.captureTimer = null;
    for (const unlisten of this.unlisten.splice(0)) unlisten();
  }

  private scheduleCapture(): void {
    if (this.captureTimer !== null) window.clearTimeout(this.captureTimer);
    this.captureTimer = window.setTimeout(() => {
      this.captureTimer = null;
      void this.capture();
    }, CAPTURE_DELAY_MS);
  }

  private async capture(): Promise<void> {
    if (await this.window.isMinimized()) return;
    const maximized = await this.window.isMaximized();
    if (!maximized) {
      const [position, size] = await Promise.all([
        this.window.outerPosition(),
        this.window.outerSize()
      ]);
      if (size.width >= MIN_WINDOW_WIDTH && size.height >= MIN_WINDOW_HEIGHT) {
        this.normalBounds = {
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height
        };
      }
    }
    if (!this.normalBounds) return;
    localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify({
      ...this.normalBounds,
      maximized
    } satisfies PersistedWindowState));
  }
}
