# Khmer runtime dictionaries

These compiled artifacts are generated from the language data pinned by the
`third_party/khmer_segmenter` submodule:

- `khmer_dictionary.kdict` supplies deterministic segmentation boundaries.
- `khmer_hyphenation.kdict` supplies optional layout break metadata.

They are application runtime data, not an independent editable source of Khmer
vocabulary. Rebuild both artifacts whenever the submodule's dictionary model
changes.

The source attribution, usage terms, and rebuild procedure are documented in
the pinned submodule's `docs/DATA.md` and `docs/EMBEDDED_DICTIONARY.md` files.
