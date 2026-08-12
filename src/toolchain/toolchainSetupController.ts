import type { SystemToolchain, ToolchainStatus } from "./toolchainController";

type TinymistRelease = { version: string; publishedAt: string | null };

export interface ToolchainSetupDependencies {
  listReleases(): Promise<TinymistRelease[]>;
  listSystemToolchains(): Promise<SystemToolchain[]>;
  install(version: string): Promise<ToolchainStatus>;
  selectSystemToolchain(path: string): Promise<ToolchainStatus>;
  closeWindow(): Promise<void>;
  showInstallError(error: unknown): Promise<void>;
  showSelectionError(error: unknown): Promise<void>;
}

export class ToolchainSetupController {
  private systemToolchains: SystemToolchain[] = [];

  constructor(private readonly deps: ToolchainSetupDependencies) {}

  async show(): Promise<ToolchainStatus | null> {
    return new Promise<ToolchainStatus | null>(resolve => {
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
      void this.populateToolchains(versionSelect, versionHint);

      versionSelect.addEventListener("change", () => {
        const hasSelection = Boolean(versionSelect.value);
        downloadBtn.disabled = !hasSelection;
        downloadBtn.textContent = versionSelect.value.startsWith("system:") ? "Use Toolchain" : "Download";
        downloadBtn.style.opacity = hasSelection ? "1" : "0.55";
        downloadBtn.style.cursor = hasSelection ? "pointer" : "default";
      });
      exitBtn.addEventListener("click", () => { void this.deps.closeWindow(); });
      downloadBtn.addEventListener("click", () => {
        const selection = versionSelect.value;
        if (!selection) return;
        if (selection.startsWith("system:")) {
          void this.selectSystemToolchain(selection, overlay, downloadBtn, resolve);
          return;
        }
        void this.installSelectedVersion({
          selectedVersion: selection.slice("managed:".length),
          overlay,
          versionPicker,
          actions,
          progressContainer,
          progressLabel,
          progressBar,
          resolve,
        });
      });
    });
  }

  private async populateToolchains(versionSelect: HTMLSelectElement, versionHint: HTMLElement): Promise<void> {
    const [systemResult, releaseResult] = await Promise.allSettled([
      this.deps.listSystemToolchains(),
      this.deps.listReleases(),
    ]);
    this.systemToolchains = systemResult.status === "fulfilled" ? systemResult.value : [];
    const releases = releaseResult.status === "fulfilled" ? releaseResult.value : [];

    versionSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a toolchain...";
    versionSelect.appendChild(placeholder);

    if (this.systemToolchains.length > 0) {
      const group = document.createElement("optgroup");
      group.label = "System PATH";
      this.systemToolchains.forEach((toolchain, index) => {
        const option = document.createElement("option");
        option.value = `system:${index}`;
        option.textContent = `Tinymist ${toolchain.tinymistVersion} (Typst ${toolchain.typstVersion})`;
        option.title = toolchain.path;
        group.appendChild(option);
      });
      versionSelect.appendChild(group);
    }

    if (releases.length > 0) {
      const group = document.createElement("optgroup");
      group.label = "Managed downloads";
      for (const release of releases) {
        const option = document.createElement("option");
        option.value = `managed:${release.version}`;
        option.textContent = release.version;
        group.appendChild(option);
      }
      versionSelect.appendChild(group);
    }

    if (this.systemToolchains.length > 0) {
      versionHint.textContent = `${this.systemToolchains.length} system installation${this.systemToolchains.length === 1 ? "" : "s"} detected. Managed downloads remain available below.`;
    } else if (releases.length > 0) {
      versionHint.textContent = `${releases.length} stable releases available. The latest is ${releases[0]?.version ?? "unknown"}.`;
    } else {
      versionSelect.innerHTML = "<option value=\"\">Failed to load releases</option>";
      versionHint.textContent = "No system Tinymist was detected and GitHub could not be reached.";
    }
  }

  private async selectSystemToolchain(
    selection: string,
    overlay: HTMLElement,
    downloadBtn: HTMLButtonElement,
    resolve: (status: ToolchainStatus | null) => void,
  ): Promise<void> {
    const toolchain = this.systemToolchains[Number(selection.slice("system:".length))];
    if (!toolchain) return;
    downloadBtn.disabled = true;
    try {
      const status = await this.deps.selectSystemToolchain(toolchain.path);
      overlay.classList.add("hidden");
      resolve(status);
    } catch (error) {
      await this.deps.showSelectionError(error);
      downloadBtn.disabled = false;
    }
  }

  private async installSelectedVersion(args: {
    selectedVersion: string;
    overlay: HTMLElement;
    versionPicker: HTMLElement;
    actions: HTMLElement;
    progressContainer: HTMLElement;
    progressLabel: HTMLElement;
    progressBar: HTMLElement;
    resolve(status: ToolchainStatus | null): void;
  }): Promise<void> {
    const { selectedVersion, overlay, versionPicker, actions, progressContainer, progressLabel, progressBar, resolve } = args;
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
      progressBar.style.width = `${Math.min(93, progress)}%`;
    }, 300);

    try {
      const status = await this.deps.install(selectedVersion);
      window.clearInterval(progressInterval);
      progressBar.style.width = "100%";
      progressLabel.textContent = "Installation complete!";
      await new Promise<void>(done => window.setTimeout(done, 700));
      overlay.classList.add("hidden");
      resolve(status);
    } catch (error) {
      window.clearInterval(progressInterval);
      progressBar.style.width = "0%";
      progressLabel.textContent = "Installation failed. Please try again.";
      await this.deps.showInstallError(error);
      progressContainer.classList.add("hidden");
      versionPicker.classList.remove("hidden");
      actions.classList.remove("hidden");
    }
  }
}
