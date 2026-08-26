# Development

## Tech stack

- Core framework: [Tauri v2](https://v2.tauri.app/)
- Backend: Rust in `src-tauri/`
- Frontend: Bun + Vite + TypeScript in `src/`
- Editor: CodeMirror 6
- Typst preview and diagnostics: Tinymist

## Local development

```bash
git clone --recurse-submodules https://github.com/Sovichea/typsastra.git
cd typsastra
bun install --frozen-lockfile
bun run tauri:dev
```

The first launch requires internet access to retrieve the selected stable Tinymist binary from GitHub. Later launches use the managed copy in the platform application-data directory.

### Tauri CLI fallback

`bun run tauri:dev` and `bun run tauri:build` normally use the bundled
`@tauri-apps/cli`. If that native CLI executable is missing, has an incompatible
format, or crashes, the launcher reads the locked CLI version, installs the
matching Rust `tauri-cli` through Cargo when necessary, and retries the same
command with `cargo tauri`. It does not retry ordinary frontend/Rust build
failures or a development session stopped with Ctrl+C. Rust and Cargo must be
available on `PATH` for the fallback.

## Dependency lockfiles

`bun.lock` is committed and is the reproducible dependency source for local development and CI. After changing `package.json`, run `bun install` and commit both files. Routine setup and CI should keep using:

```bash
bun install --frozen-lockfile
```

## Validation

Run the frontend and Rust checks before submitting changes:

```bash
bun test
bun run build
cargo fmt --manifest-path src-tauri/Cargo.toml --package typsastra -- --check
cargo check --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Changes to Khmer editing policies, Unicode utilities, spellcheck, completion, native segmentation, dictionaries, or the pinned segmenter must also keep the focused reference suite passing:

```bash
bun run test:khmer
cargo test --manifest-path src-tauri/Cargo.toml --lib khmer_reference_provider_fixtures_are_locked
```

## Architecture notes

- Tauri handles native windows, filesystem access, dialogs, settings persistence, and the LSP lifecycle.
- CodeMirror owns editor state, syntax behavior, autocomplete, selection, and decorations.
- Tinymist provides Typst diagnostics, preview, export, and source synchronization.
- Language analysis is handled by the Rust provider registry. Bundled providers include custom Khmer support and English Hunspell support.
- Public positioning, feature names, and Basic/Enhanced/Deep language-support criteria are defined in [PRODUCT_DIRECTION.md](./PRODUCT_DIRECTION.md).
- Script-aware cursor movement and deletion use the frontend policy registry documented in [SCRIPT_EDITING_POLICIES.md](./SCRIPT_EDITING_POLICIES.md).
- Khmer is the locked reference implementation documented in [KHMER_SPELLCHECK.md](./KHMER_SPELLCHECK.md); its fixtures record the pinned upstream commit and exact editing, normalization, segmentation, and completion behavior.
- Settings are stored in a versioned `settings.json` in the platform application-config directory.

## Preview behavior

Each preview root has a uniquely identified Tinymist task whose iframe is cached across tab switches. Imported files normally preview through the top-level `main.typ` and update on save.

Imported chapters currently use the configured main document's preview. The former `// @standalone-preview` directive remains disabled because independent preview roots made source synchronization unreliable. A portable Full Document/Active File replacement is deferred to a dedicated future milestone; it is not part of v0.8.0.

PDF preview and source-map synchronization are documented in [PREVIEW_INTERCEPTION.md](./PREVIEW_INTERCEPTION.md).

## Release builds

```bash
bun run tauri:build
```

Build on each target operating system. Cross-platform installer output is not produced by a normal local Tauri build.

To bypass the bundled CLI explicitly, install the version resolved in
`bun.lock` and run Cargo directly. For the current lockfile:

```bash
cargo install tauri-cli --version 2.11.3 --locked
cargo tauri build
```
