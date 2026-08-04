# Typsastra examples

This workspace is a writable learning copy installed in a versioned folder in
your Documents directory, such as `Typsastra Examples v0.6.0`. Open
`START-HERE.typ` for the recommended order.

Each application release creates and opens its own examples folder. A newer
release never overwrites, migrates, or reuses an older version's writable copy.
Within one version, Typsastra may restore a missing bundled file, but it
preserves files you have edited.

Each non-trivial example documents its prerequisites and expected result. Some
font families and language dictionaries are optional and are never bundled into
an exported project. Missing optional dictionaries are intentionally visible in
the language-provider examples so you can test installation and unavailable
provider behavior.

The source remains ordinary Typst. Generated PDFs, preview caches, downloaded
providers, and font binaries do not belong in this workspace's bundled source.

Tutorials: <https://github.com/Sovichea/typsastra/tree/main/docs/tutorials>

The Basics section includes a diacritic-aware search fixture for testing exact
accent matching, accent-insensitive matching, replacement ranges, and the
preservation of complex-script marks.

## v0.6.0 showcase

The `06-v0.6-feature-showcase` section provides short exercises for:

- Draft Preview, cached image hover cards, and image optimization diagnostics;
- manual forward sync, inverse sync, and internal or external preview links;
- private local font directories and ordered Typst font fallback.

These complement the existing multilingual and research projects. The examples
do not bundle pathological images or private fonts; use your own assets when you
want to test those machine-specific workflows.
