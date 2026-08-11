import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { dirname, join } from "@tauri-apps/api/path";
import {
  parseDocumentScripts,
  parseTypographyBlock,
  typographyScaleExceedsFineAdjustment,
  unsupportedTypstInternalFontScales,
  type DocumentScriptFont,
  type DocumentTypography,
} from "../editor/documentTypography";
import {
  effectiveTemplateTypography,
  findLocalTemplateApplication,
} from "../editor/templateTypography";
import { relativeFilePath } from "../platform/paths";

export interface FontVariantLimitWarning {
  family: string;
  cachedVariants: number;
  requestedScale: number;
  recommendedLimit: number;
}

export interface ScaledFontSetStatus {
  updateRequired: boolean;
  generationRequired: boolean;
  variantLimitWarnings: FontVariantLimitWarning[];
}

export interface TypographyControllerPort {
  getWorkspaceRootPath(): string | null;
  readWorkspaceText(path: string): Promise<string>;
  logWarning(message: string): void;
}

/** Owns document typography resolution, validation, and confirmation policy. */
export class TypographyController {
  constructor(private readonly port: TypographyControllerPort) {}

  public fromText(text: string): DocumentTypography | null {
    const managed = parseTypographyBlock(text);
    if (managed) return managed;
    const fonts = parseDocumentScripts(text);
    return fonts.length > 0 ? { baseSizePt: 11, fonts } : null;
  }

  public async effective(path: string, text: string): Promise<DocumentTypography | null> {
    const localTypography = parseTypographyBlock(text);
    if (localTypography) return localTypography;

    const application = findLocalTemplateApplication(text);
    if (application) {
      try {
        const templatePath = await join(await dirname(path), application.importPath);
        const workspaceRoot = this.port.getWorkspaceRootPath();
        const insideWorkspace = !workspaceRoot
          || relativeFilePath(workspaceRoot, templatePath) !== null;
        if (insideWorkspace && await invoke<boolean>("workspace_path_exists", { path: templatePath })) {
          const templateText = await this.port.readWorkspaceText(templatePath);
          const templateTypography = effectiveTemplateTypography(text, templateText);
          if (templateTypography) return templateTypography;
        }
      } catch (error) {
        this.port.logWarning(
          `Could not resolve typography from ${application.importPath}: ${String(error)}`,
        );
      }
    }

    return this.fromText(text);
  }

  public scaleRangeWarning(config: DocumentTypography): string | null {
    const outsideFineRange = config.fonts.filter(font =>
      typographyScaleExceedsFineAdjustment(font.scale)
    );
    if (outsideFineRange.length === 0) return null;
    return `The following font scales exceed the recommended 0.90×–1.10× fine-adjustment range:\n\n${outsideFineRange.map(font => `${font.family}: ${font.scale}×`).join("\n")}\n\nFont scaling is intended for small optical adjustments between script families, not for doubling or substantially changing text size. Beyond ±10%, accurate representation is not guaranteed and results vary from one font to another. Use the document text size for larger size changes.\n\nContinue anyway?`;
  }

  public async confirmScaleRange(config: DocumentTypography): Promise<boolean> {
    const warning = this.scaleRangeWarning(config);
    if (!warning) return true;
    return confirm(warning, { title: "Large Font Scale Adjustment", kind: "warning" });
  }

  public async unsupportedInternalScaleError(config: DocumentTypography): Promise<{
    message: string;
    fonts: DocumentScriptFont[];
  } | null> {
    const catalog = await invoke<{ all: string[] }>("list_system_fonts", {
      workspaceRootPath: this.port.getWorkspaceRootPath(),
    });
    const unsupported = unsupportedTypstInternalFontScales(config.fonts, catalog.all);
    if (unsupported.length === 0) return null;
    return {
      fonts: unsupported,
      message: `The following fonts are provided internally by the Typst compiler and cannot be scaled by Typsastra:\n\n${unsupported.map(font => `${font.family}: ${font.scale}×`).join("\n")}\n\nTypsastra will reset their scale to 1×. Install the corresponding font family locally before using a custom scale. Typsastra will not generate or extract variants from compiler-embedded fonts.`,
    };
  }

  public resetUnsupportedInternalScales(
    config: DocumentTypography,
    unsupported: readonly DocumentScriptFont[],
  ): DocumentTypography {
    return {
      ...config,
      fonts: config.fonts.map(font => ({
        ...font,
        scale: unsupported.some(candidate =>
          candidate.script === font.script && candidate.family === font.family
        ) ? 1 : font.scale,
      })),
    };
  }

  public async scaledFontSetStatus(config: DocumentTypography): Promise<ScaledFontSetStatus> {
    const workspaceRootPath = this.port.getWorkspaceRootPath();
    if (!workspaceRootPath) {
      return { updateRequired: false, generationRequired: false, variantLimitWarnings: [] };
    }
    return invoke<ScaledFontSetStatus>("scaled_workspace_font_set_status", {
      workspaceRootPath,
      fonts: config.fonts,
    });
  }

  public variantLimitWarning(status: ScaledFontSetStatus): string | null {
    if (status.variantLimitWarnings.length === 0) return null;
    const variants = status.variantLimitWarnings.map(warning =>
      `${warning.family}: ${warning.cachedVariants} cached variants; requested ${warning.requestedScale}×`
    ).join("\n");
    const limit = Math.min(...status.variantLimitWarnings.map(warning => warning.recommendedLimit));
    return `Typsastra recommends keeping no more than ${limit} scaled variants per font face. This change would add another variant for:\n\n${variants}\n\nExisting variants will not be deleted automatically. Advanced font-variant management is planned for a future update, where variants can be deleted or renewed.\n\nCreate the additional variant anyway?`;
  }

  public async confirmVariantLimit(config: DocumentTypography): Promise<boolean> {
    const warning = this.variantLimitWarning(await this.scaledFontSetStatus(config));
    if (!warning) return true;
    return confirm(warning, {
      title: "Font Variant Cache Limit",
      kind: "warning",
      okLabel: "Create Variant",
      cancelLabel: "Cancel",
    });
  }
}
