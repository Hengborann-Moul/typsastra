export interface ImagePreviewControllerPort {
  setMessage(html: string): void;
  setError(title: string, detail: string): void;
  updateToolbar(path: string): void;
  updateZoomLabel(scale: number): void;
}

/** Owns the interactive image preview's transient zoom, pan, and fit state. */
export class ImagePreviewController {
  private zoomInAction: (() => void) | null = null;
  private zoomOutAction: (() => void) | null = null;
  private zoomToFitAction: (() => void) | null = null;
  private zoomPercentAction: (() => number) | null = null;
  private fitStateAction: (() => boolean) | null = null;

  constructor(private readonly port: ImagePreviewControllerPort) {}

  clear(): void {
    this.zoomInAction = null;
    this.zoomOutAction = null;
    this.zoomToFitAction = null;
    this.zoomPercentAction = null;
    this.fitStateAction = null;
  }

  get zoomPercent(): number | null {
    return this.zoomPercentAction?.() ?? null;
  }

  get isFit(): boolean | null {
    return this.fitStateAction?.() ?? null;
  }

  zoomIn(): boolean {
    if (!this.zoomInAction) return false;
    this.zoomInAction();
    return true;
  }

  zoomOut(): boolean {
    if (!this.zoomOutAction) return false;
    this.zoomOutAction();
    return true;
  }

  zoomToFit(): boolean {
    if (!this.zoomToFitAction) return false;
    this.zoomToFitAction();
    return true;
  }

  render(src: string, previewPath: string): void {
    this.port.updateToolbar(previewPath);
    this.port.setMessage(
      `<div id="interactive-image-container" style="position:relative;width:100%;height:100%;background:var(--ui-bg);overflow:hidden;display:flex;align-items:center;justify-content:center;user-select:none;box-sizing:border-box;">` +
      `<img id="interactive-image-el" alt="Image preview" draggable="false" style="max-width:none;max-height:none;position:absolute;cursor:grab;user-select:none;will-change:transform;visibility:hidden;" />` +
      `</div>`,
    );

    const container = document.getElementById("interactive-image-container");
    const image = document.getElementById("interactive-image-el") as HTMLImageElement | null;
    if (!container || !image) return;

    let scale = 1;
    let x = 0;
    let y = 0;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let fit = true;

    const updateTransform = () => {
      image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    };
    const resetToFit = () => {
      if (
        container.clientWidth <= 0
        || container.clientHeight <= 0
        || image.naturalWidth <= 0
        || image.naturalHeight <= 0
      ) return;
      scale = Math.min(
        container.clientWidth / image.naturalWidth,
        container.clientHeight / image.naturalHeight,
        1,
      );
      x = 0;
      y = 0;
      updateTransform();
      image.style.visibility = "visible";
    };
    const updateZoom = () => this.port.updateZoomLabel(scale);

    this.zoomInAction = () => {
      scale = Math.min(scale * 1.2, 20);
      fit = false;
      updateTransform();
      updateZoom();
    };
    this.zoomOutAction = () => {
      scale = Math.max(scale / 1.2, 0.05);
      fit = false;
      updateTransform();
      updateZoom();
    };
    this.zoomToFitAction = () => {
      resetToFit();
      fit = true;
      updateZoom();
    };
    this.zoomPercentAction = () => scale;
    this.fitStateAction = () => fit;

    image.onload = () => {
      requestAnimationFrame(() => {
        resetToFit();
        fit = true;
        updateZoom();
      });
    };
    image.onerror = () => this.port.setError(
      "Image preview unavailable",
      "Typsastra could not decode this image.",
    );
    image.src = src;

    container.addEventListener("wheel", event => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const mouseX = event.clientX - rect.left - rect.width / 2;
      const mouseY = event.clientY - rect.top - rect.height / 2;
      const previousScale = scale;
      scale = event.deltaY < 0
        ? Math.min(scale * 1.1, 20)
        : Math.max(scale / 1.1, 0.05);
      x = mouseX - (mouseX - x) * (scale / previousScale);
      y = mouseY - (mouseY - y) * (scale / previousScale);
      fit = false;
      updateTransform();
      updateZoom();
    }, { passive: false });

    container.addEventListener("mousedown", event => {
      if (event.button !== 0) return;
      dragging = true;
      image.style.cursor = "grabbing";
      startX = event.clientX - x;
      startY = event.clientY - y;
      event.preventDefault();
    });
    window.addEventListener("mousemove", event => {
      if (!dragging) return;
      x = event.clientX - startX;
      y = event.clientY - startY;
      updateTransform();
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      image.style.cursor = "grab";
    });
  }
}
