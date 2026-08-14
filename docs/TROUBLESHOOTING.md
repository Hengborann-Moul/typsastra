# Troubleshooting

For a workflow-oriented starting point, see the
[tutorial troubleshooting guide](./tutorials/TROUBLESHOOTING.md). This reference
keeps the detailed build, packaging, platform, and diagnostic procedures.

## Native features do not work in the browser

Use:

```bash
bun run tauri:dev
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

Open **Settings → Toolchain** first. A compatible validated Tinymist found on
the system `PATH` can be selected without a managed download. Otherwise verify
GitHub access and retry the managed release. The progress indicator reports
received bytes; an unchanged transfer is treated as stalled and retried within
bounded limits. A system `typst` executable is not a Tinymist replacement.

## Markdown preview blocks an image or link

Local Markdown images must resolve inside the open workspace. Missing files,
paths outside the workspace, unsafe URL schemes, and remote images are blocked;
remote resources are never fetched automatically. Move a required local asset
into the workspace and use a relative Markdown path. Open an external link only
through the explicit link action.

## Preview or inverse sync problems

Preview behavior is handled by Tinymist and Typsastra's preview iframe layer. Developer notes are in [PREVIEW_INTERCEPTION.md](./PREVIEW_INTERCEPTION.md).

When reporting preview issues, include:

- Operating system.
- Typsastra version.
- Whether the preview is docked or undocked.
- Whether the file is `main.typ` or an included file.
- Any visible messages from the developer log console.

### A scanned PDF is faint or missing text

Scanner-generated MRC PDFs can store visible text and line art in a separate
CCITT or JBIG2 foreground mask over a lower-resolution background image.
Typsastra packages the PDF.js decoders for these layers; it does not OCR or
rewrite the file.

If a scanned PDF still looks incomplete:

1. Confirm the same page renders correctly in an external PDF reader.
2. Confirm whether the problem occurs while opening the PDF directly or only in
   a PDF compiled from Typst.
3. Reopen the file after updating Typsastra so the viewer and packaged decoder
   assets are loaded from the same release.
4. Report the operating system, Typsastra version, affected page number, and
   developer-log output. Do not share the document when it contains restricted
   material; a redacted sample with the same scanner encoding is sufficient.

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

### Moving project files while Typsastra is open may be detected in stages

This is a known limitation. Typsastra watches the workspace recursively, but
operating systems, cloud-synchronized directories, and network filesystems may
report one move as a rename or as separate remove and create events. Events can
also arrive late or, less commonly, be missed.

Typsastra validates the render cache during the next preview preparation.
Source maps are reused only when their source path, generated path, content
digest, schema version, and preview mode still match. Obsolete mirrored
directories and their corresponding source-map directories are removed.
Moving a file through Typsastra performs this refresh directly; an externally
moved file normally triggers it through the workspace watcher.

If a watcher event is missed, stale disposable artifacts may remain under
`.typsastra/cache` until the next compilation, manual recompile, main-file
change, or workspace restart. They must not be treated as authoritative after
that preparation cycle. If preview synchronization still refers to an old
location, manually recompile or restart the workspace; deleting `.typsastra`
should be a last-resort diagnostic because it also removes local workspace
state.

A future hardening pass should introduce a serialized workspace-structure
revision. Every accepted create, remove, or rename event would invalidate
in-flight preparation and schedule one consolidated mirror rebuild after the
event stream settles.

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
