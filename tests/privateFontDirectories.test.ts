import { describe, expect, test } from "bun:test";

describe("private local font directories", () => {
  test("groups document fonts by built-in, private, then system origin", async () => {
    const source = await Bun.file(new URL("../src/editor/toolbarController.ts", import.meta.url)).text();
    const builtIn = source.indexOf('group("Typst built-in"');
    const privateLocal = source.indexOf('group("Private local"');
    const system = source.indexOf('group("System fonts"');

    expect(builtIn).toBeGreaterThan(-1);
    expect(privateLocal).toBeGreaterThan(builtIn);
    expect(system).toBeGreaterThan(privateLocal);
  });

  test("persists paths globally and rejects ambiguous font families", async () => {
    const settings = await Bun.file(new URL("../src/settingsController.ts", import.meta.url)).text();

    expect(settings).toContain("settings.fonts.privateDirectories");
    expect(settings).toContain('"inspect_private_font_directory"');
    expect(settings).toContain("inspection.collisions.length > 0");
    expect(settings).toContain('new Event("typsastra:private-fonts-changed")');
  });

  test("applies one combined font-path policy to compiler entry points", async () => {
    const native = await Bun.file(new URL("../src-tauri/src/lib.rs", import.meta.url)).text();

    expect(native).toContain("fn configured_private_font_directories");
    expect(native).toContain("fn compiler_font_directories");
    expect(native).toContain("apply_workspace_font_paths(&mut command, &app_handle, &data_dir, parent)");
    expect(native).toContain("compiler_font_directories(&app_handle, &data_dir, Path::new(workspace_root))");
  });

  test("keeps workspace folders local while preserving relative project folders", async () => {
    const native = await Bun.file(new URL("../src-tauri/src/lib.rs", import.meta.url)).text();
    const toolbar = await Bun.file(new URL("../src/editor/toolbarController.ts", import.meta.url)).text();

    expect(native).toContain(".join(\"local.json\")");
    expect(native).toContain("is_safe_relative_workspace_font_path");
    expect(native).toContain("workspace_font_directory_storage_path");
    expect(native).toContain("save_workspace_private_font_directories");
    expect(toolbar).toContain("toolbar-workspace-private-fonts-section");
    expect(toolbar).toContain('"save_workspace_private_font_directories"');
  });
});
