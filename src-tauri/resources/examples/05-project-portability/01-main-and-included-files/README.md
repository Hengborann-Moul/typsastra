# Main and included files

1. Right-click `main.typ` and select **Set as Main File**.
2. Open `chapters/included.typ`.
3. Navigate the preview to page 2, then switch between `main.typ` and the
   included chapter. The same PDF page should remain visible.
4. Edit or forward-sync from the included chapter.

Expected behavior: the editor stays on the included source while the preview
continues to show the complete `main.typ` document. Main and included tabs share
one preview position; changing tabs must not restore a separate page or silently
change the project main file.

Large-file confirmation also belongs to the complete project document. If a
real project requires approval before opening its large main preview, included
files reuse that approval instead of prompting independently.

Tutorial: <https://github.com/Sovichea/typsastra/blob/main/docs/tutorials/PROJECTS_AND_MAIN_FILES.md>
