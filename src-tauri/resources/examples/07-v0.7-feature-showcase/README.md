# v0.7.0 feature showcase

This section demonstrates features added in Typsastra v0.7.0.

- Open `01-markdown-live-preview/README.md` to exercise the sanitized Markdown
  renderer, GFM structures, workspace links, mixed scripts, and local images.
- Open `../06-v0.6-feature-showcase/01-draft-preview-and-image-guidance/main.typ`,
  then choose Image Tools in the sidebar to inspect and optimize its bundled
  raster assets.
- Open `../01-basics/03-diacritic-aware-search/main.typ` to exercise
  theme-aware wrapped matches, selected-text search, and exact scrollbar-marker
  navigation.
- Open `../05-project-portability/01-main-and-included-files/main.typ` to verify
  that the main file and its included chapter share one preview page position.

Image optimization always begins with a preview and **Save Optimized Copy**.
Keep the examples reusable by saving experimental output under a new name.

## Inspect machine-local project storage

1. Compile or preview any bundled example.
2. Open **Settings → Storage**.
3. Find the examples workspace and review its generated-file count, total size,
   hard-linked bytes, and genuinely copied bytes.
4. Use the explicit reveal action to inspect the machine-local cache directory.

The generated cache should not appear inside this examples workspace. A hard
link may have multiple filesystem paths while sharing one underlying storage
allocation, so its apparent file size is not additional copied storage.

Legacy-cache migration is not manufactured by these examples. Typsastra asks
for consent when it encounters a real older `.typsastra/cache`; cancelling must
preserve that directory and stop the project from opening.

