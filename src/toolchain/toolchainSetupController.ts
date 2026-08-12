import type { ToolchainStatus } from "./toolchainController";

type TinymistRelease = { version: string; publishedAt: string | null };

export interface ToolchainSetupDependencies {
  listReleases(): Promise<TinymistRelease[]>;
  install(version: string): Promise<ToolchainStatus>;
  closeWindow(): Promise<void>;
  showInstallError(error: unknown): Promise<void>;
}

export class ToolchainSetupController {
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
      void this.populateVersions(versionSelect, versionHint);

      versionSelect.addEventListener("change", () => {
        const hasVersion = Boolean(versionSelect.value);
        downloadBtn.disabled = !hasVersion;
        downloadBtn.style.opacity = hasVersion ? "1" : "0.55";
        downloadBtn.style.cursor = hasVersion ? "pointer" : "default";
      });
      exitBtn.addEventListener("click", () => { void this.deps.closeWindow(); });
      downloadBtn.addEventListener("click", () => {
        const selectedVersion = versionSelect.value;
        if (!selectedVersion) return;
        void this.installSelectedVersion({
          selectedVersion,
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

  private async populateVersions(versionSelect: HTMLSelectElement, versionHint: HTMLElement): Promise<void> {
    try {
      const releases = await this.deps.listReleases();
      versionSelect.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select a version...";
      versionSelect.appendChild(placeholder);
      for (const release of releases) {
        const option = document.createElement("option");
        option.value = release.version;
        option.textContent = release.version;
        versionSelect.appendChild(option);
      }
      versionHint.textContent = `${releases.length} stable releases available. The latest is ${releases[0]?.version ?? "unknown"}.`;
    } catch {
      versionSelect.innerHTML = "<option value=\"\">Failed to load releases</option>";
      versionHint.textContent = "Could not reach GitHub. Check your internet connection and try again.";
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
