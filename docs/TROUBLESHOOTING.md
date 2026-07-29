# Troubleshooting

For a workflow-oriented starting point, see the
[tutorial troubleshooting guide](./tutorials/TROUBLESHOOTING.md). This reference
keeps the detailed build, packaging, platform, and diagnostic procedures.

## Native features do not work in the browser

Use:

```bash
bun run tauri dev
```

`bun run dev` starts only Vite in a browser. Native filesystem access, dialogs, settings persistence, Tinymist, and Tauri IPC will not work there.

## Windows build errors

### `LNK1104: cannot open file 'msvcrt.lib'`

Install the Visual Studio **Desktop development with C++** workload and Windows SDK, then restart the terminal.

### MSI packaging fails with `light.exe` or VBSCRIPT errors

Enable **VBSCRIPT** under Windows Optional Features. This is needed only for MSI generation.

## Linux build errors

### `webkit2gtk-4.1` or `javascriptcoregtk-4.1` missing

Install the WebKitGTK 4.1 packages for your distribution. See [INSTALL.md](./INSTALL.md).

## macOS reports that Typsastra is damaged

The experimental macOS release is intentionally distributed without Apple
Developer ID signing or notarization. Gatekeeper can consequently display
**“Typsastra.app is damaged and can't be opened”** after a browser download
even when the application bundle is intact.

First ensure the app was downloaded from the official Typsastra GitHub release.
Move it to `/Applications`, then remove quarantine from Typsastra only and open
it:

```bash
xattr -dr com.apple.quarantine "/Applications/Typsastra.app"
open "/Applications/Typsastra.app"
```

Never disable Gatekeeper globally. If this targeted workaround fails, delete
the app and download it again before reporting the release filename, Mac model,
processor architecture, and macOS version. See the complete safety notes in
[INSTALL.md](./INSTALL.md#open-an-unsigned-macos-release).

In-app updates are independently protected by mandatory Tauri updater
signatures and normally should not need quarantine removal again. Manually
downloading a newer build through a browser may require repeating the targeted
workaround.

## Shell cannot find `bun` or `cargo`

Restart the terminal and verify that the relevant directories are on `PATH`:

- Bun: `~/.bun/bin`
- Rust: `~/.cargo/bin`

Then verify:

```bash
git --version
rustc --version
cargo --version
bun --version
```

## Tinymist cannot be downloaded

Verify GitHub access and retry from **Settings → Toolchain**. A system `typst` executable does not replace the managed Tinymist requirement.

## Preview or inverse sync problems

Preview behavior is handled by Tinymist and Typsastra's preview iframe layer. Developer notes are in [PREVIEW_INTERCEPTION.md](./PREVIEW_INTERCEPTION.md).

When reporting preview issues, include:

- Operating system.
- Typsastra version.
- Whether the preview is docked or undocked.
- Whether the file is `main.typ` or an included file.
- Any visible messages from the developer log console.

### Tinymist memory remains high after switching to Draft Preview

This is a known limitation. Opening an image-heavy document in Normal Preview
can establish a much higher Tinymist memory watermark than opening the same
document directly in Draft Preview. Switching from Normal to Draft reduces the
cost of later preview compilations, but it does not immediately return memory
already retained by the running Tinymist process.

Tinymist ages different compiler caches over multiple compilation generations,
and its allocator or the operating system may continue to retain released
pages. The internal cache age of 10 used for some memoized work is not a
guarantee that process memory will fall after exactly 10 edits; other caches
have different lifetimes.

Restarting Tinymist is currently the only dependable way to request immediate
process-level reclamation, but it also discards incremental compilation and
source-map warm state. Typsastra therefore does not restart Tinymist
automatically when switching preview modes. A later release will review a
memory-aware recovery policy after repeated Normal/Draft measurements.

### Linux preview is completely white

If PDF export succeeds but the embedded preview is white or only appears briefly while resizing, open **Settings → Preview → Linux preview compatibility**. Review the detected session, WebKitGTK version, and graphics vendor, then enable **Disable WebKitGTK DMA-BUF renderer** and restart Typsastra.

The equivalent temporary launch workaround is:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 typsastra
```

For an AppImage:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Typsastra_0.5.3_amd64.AppImage
```

This is a WebKitGTK rendering workaround. It does not change Typst compilation or the exported PDF and may reduce rendering performance. When reporting the issue, also include `echo "$XDG_SESSION_TYPE"` and the installed `libwebkit2gtk-4.1-0` version where available.

### Windows layout or preview sync is incorrect after waking

Windows hibernate or sleep can invalidate the hidden preview source-map
WebSocket without a normal closing handshake. If suspension interrupts a pane
drag, Windows can also omit the final pointer event and leave Typsastra's
temporary resizing presentation active.

The v0.5.3 development line detects a system-resume gap, clears interrupted
resize state, restores the editor layout, and rebuilds the source-map
connection without recompiling an otherwise valid PDF. The specific
`Connection reset without closing handshake` message is treated as an expected
suspension disconnect.

This remains an intermittent known issue under monitoring. WebView2,
GPU-driver, and display-scaling behavior can vary between wake cycles. If the
problem recurs, include:

- the developer-log entry beginning `Recovered after system resume`;
- whether the whole interface or only the PDF preview is scaled incorrectly;
- whether moving or resizing the application window restores the layout;
- Windows display scaling and whether a monitor was connected or removed;
- whether forward and inverse synchronization recover afterward.
