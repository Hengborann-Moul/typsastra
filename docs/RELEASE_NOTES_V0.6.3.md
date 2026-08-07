# Typsastra v0.6.3 release notes

Typsastra v0.6.3 builds on v0.6.2 with more reliable contextual completion,
stronger Khmer authoring behavior, improved editor navigation, and safer
workspace lifecycle management.

Released August 7, 2026.

## Typst completion and editor workflow

- Refined Tinymist completion for functions, bracket-content forms, members,
  `#set` and `#show` rules, quoted values, and named arguments.
- Deduplicated callable variants and learned each user's preferred completion
  form globally without allowing that preference to override argument context.
- Added editable, type-aware starter values for named arguments while
  preserving values supplied by Tinymist.
- Accepted completion with Enter or Tab, reserved `Ctrl+Enter` for a newline,
  corrected partial-prefix replacement, and reopened relevant arguments after
  commas and accepted fields.
- Prevented completion races after Tinymist restarts and deferred preview work
  while input keys are held to protect typing responsiveness.
- Added **Surround With** for selected content and grouped spelling actions in
  a clearer context submenu.

## Search, navigation, and visual feedback

- Added diacritic-aware search, accurate result navigation, and a bundled
  example for testing equivalent and exact-diacritic matching.
- Improved fuzzy ranking in Surround With and recent-project search so exact
  and prefix matches appear before weaker fuzzy matches.
- Added guarded forward sync to the editor context menu.
- Added extra scroll space beyond the final line, restored editor scroll
  state more reliably, and displayed a caret-position marker when needed.
- Stabilized bracket-pair coloring across typing and scrolling, corrected
  consecutive `#context` highlighting, and exposed LSP errors in the shared
  gutter.
- Restored the previous application window size, position, and maximized state.

## Khmer and multilingual authoring

- Updated the bundled Khmer segmenter to `0.2.0-rc.2` and integrated its newer
  word-boundary, dictionary, spellcheck, correction, and completion APIs.
- Added AltGr-safe Khmer input handling and corrected caret placement after
  trailing Khmer grapheme clusters without reintroducing start-of-line snapping
  errors.
- Made newly added Khmer user-dictionary words immediately available to both
  spellcheck segmentation and word completion.
- Waited for preferred editor fonts before revealing a restored workspace to
  avoid a brief system-font flash.

## Typography and workspace management

- Added workspace-specific private font directories. Paths inside a project
  are stored relatively; external paths remain absolute and machine-local.
- Allowed additional prepared fonts for the same script, each with its own
  scale, without forcing those families into the default text fallback stack.
- Synchronized Document Typography after fonts are edited directly in source.
- Added configurable auto-save. Automatic saves do not trigger an **On save**
  preview, while an explicit Save still requests compilation even when the
  latest content was already auto-saved.
- Rejected local Typst dependencies outside the workspace with a clear project
  boundary message, refined file/folder context actions, and corrected project
  reveal and path-copy behavior.
- Bounded retained preview generations so repeated compilation no longer grows
  the cache indefinitely.

## Compatibility and upgrade behavior

v0.6.3 does not change the Typsastra project archive schema or require a
workspace migration. Existing v0.6.x projects remain compatible. The release
installs examples into a new versioned folder and never overwrites an earlier
user-owned examples workspace.

The Draft Preview, progressive PDF loading, private-font, and multilingual
features documented for [v0.6.2](./RELEASE_NOTES_V0.6.2.md) continue to apply.
