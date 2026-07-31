# Typsastra v0.6.2 release notes

Typsastra v0.6.2 contains the complete v0.6.1 feature set and focuses on
undocked-preview reliability and consistent contextual Typst completion.

Released July 31, 2026.

## Undocked preview

- Restored PDF loading in the undocked preview after the v0.6.1 range-loading
  optimization.
- Restored the undocked preview options menu and its zoom, export, external
  viewer, and dock actions.
- Routed actions that require project ownership back to the main workspace
  without changing the active preview document.

## Typst completion

- Kept hash-triggered completion active while an identifier is being typed and
  allowed `Ctrl+Space` to reopen a completion list after it is dismissed.
- Made CodeMirror's current visible identifier authoritative when Tinymist
  returns an older or partial edit range. This prevents suffixes from being
  left behind in direct calls and `#set` or `#show` rules.
- Normalized callable completion so functions such as `page`, `figure`, and
  `circle` insert parentheses and place the caret inside an empty call.
- Requested contextual named arguments after accepting a callable completion
  or placing the caret inside a manually written empty call.
- Suppressed unrelated global suggestions inside empty function calls,
  including `#set` and `#show` rule contexts.

## Compatibility and upgrade behavior

v0.6.2 does not change the project format, the v0.6.0 example workspace, Draft
Preview caches, private-font configuration, or language-provider configuration.
Existing v0.6.x projects can be opened without migration.

The feature set, upgrade notes, and known boundaries documented for
[v0.6.1](./RELEASE_NOTES_V0.6.1.md) continue to apply.

