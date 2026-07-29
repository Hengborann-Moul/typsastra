export function tabStripWheelDelta(
  event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">,
  pageWidth: number
): number {
  const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ? event.deltaX
    : event.deltaY;
  const scale = event.deltaMode === 1
    ? 16
    : event.deltaMode === 2
      ? Math.max(1, pageWidth)
      : 1;
  return dominantDelta * scale;
}

export class TabStripController {
  private readonly resizeObserver = new ResizeObserver(() => this.scheduleUpdate());
  private readonly mutationObserver = new MutationObserver(() => this.scheduleUpdate(true));
  private updateFrame: number | null = null;

  constructor(
    private readonly strip: HTMLElement,
    private readonly previousButton: HTMLButtonElement,
    private readonly nextButton: HTMLButtonElement
  ) {}

  public initialize(): void {
    this.previousButton.addEventListener("click", () => this.scroll(-1));
    this.nextButton.addEventListener("click", () => this.scroll(1));
    this.strip.addEventListener("scroll", () => this.scheduleUpdate(), { passive: true });
    this.strip.addEventListener("wheel", event => {
      const maxScroll = Math.max(0, this.strip.scrollWidth - this.strip.clientWidth);
      if (maxScroll <= 1) return;
      const delta = tabStripWheelDelta(event, this.strip.clientWidth);
      if (Math.abs(delta) < 0.01) return;

      // Apply wheel and trackpad deltas directly so native gesture momentum is
      // preserved. Smooth scrolling here would queue animations behind the
      // incoming gesture and make the tab strip feel delayed.
      this.strip.scrollLeft = Math.max(0, Math.min(maxScroll, this.strip.scrollLeft + delta));
      event.preventDefault();
      this.scheduleUpdate();
    }, { passive: false });
    this.resizeObserver.observe(this.strip);
    this.mutationObserver.observe(this.strip, { childList: true });
    this.scheduleUpdate();
  }

  private scroll(direction: -1 | 1): void {
    this.strip.scrollBy({
      left: direction * Math.max(160, this.strip.clientWidth * 0.65),
      behavior: "smooth"
    });
  }

  private scheduleUpdate(revealActive = false): void {
    if (this.updateFrame !== null) cancelAnimationFrame(this.updateFrame);
    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = null;
      if (revealActive) {
        const activeTab = this.strip.querySelector<HTMLElement>(".editor-tab.active");
        if (activeTab) {
          const pinnedTab = this.strip.querySelector<HTMLElement>(".editor-tab.pinned-main-tab");
          const pinnedWidth = pinnedTab ? pinnedTab.offsetWidth : 0;

          const rect = activeTab.getBoundingClientRect();
          const stripRect = this.strip.getBoundingClientRect();
          const tabLeft = rect.left - stripRect.left + this.strip.scrollLeft;
          const tabRight = tabLeft + rect.width;

          const viewLeft = this.strip.scrollLeft + pinnedWidth;
          const viewRight = this.strip.scrollLeft + this.strip.clientWidth;

          if (tabLeft < viewLeft) {
            this.strip.scrollLeft = tabLeft - pinnedWidth;
          } else if (tabRight > viewRight) {
            this.strip.scrollLeft = tabRight - this.strip.clientWidth;
          }
        }
      }
      const maxScroll = Math.max(0, this.strip.scrollWidth - this.strip.clientWidth);
      const overflowing = maxScroll > 1;
      this.previousButton.classList.toggle("hidden", !overflowing);
      this.nextButton.classList.toggle("hidden", !overflowing);
      this.previousButton.disabled = !overflowing || this.strip.scrollLeft <= 1;
      this.nextButton.disabled = !overflowing || this.strip.scrollLeft >= maxScroll - 1;
    });
  }
}
