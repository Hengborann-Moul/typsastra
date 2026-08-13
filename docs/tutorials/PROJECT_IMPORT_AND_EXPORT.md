# Project import and export

## PDF export

PDF export writes the current compiled output to a user-selected destination.
Warnings emitted alongside a successful PDF must not be mistaken for a failed
export. Long Windows paths are handled without passing a fragile display string
through a command shell.

## Typsastra project archive

**Export Typsastra Project** creates a version-bound `.typsastra` ZIP container.
It includes ordinary project files, applicable portable workspace settings, a
generated manifest, exact Typst/Tinymist versions, and integrity hashes.

It excludes:

- generated PDFs and preview/source-map caches;
- `.git`, `node_modules`, `target`, and build output;
- symlinks and unsafe paths;
- every recognized font binary, regardless of license or location.

Recipients install required fonts separately. Toolchain binding improves source
compatibility but does not claim identical rendering without the same fonts.

Import validates the archive before extraction and then opens a cancellable
destination step. You can edit the proposed portable folder name before
continuing. Typsastra rejects invalid or reserved names, checks for destination
conflicts, repeats preflight before extraction, compares toolchains, verifies
hashes in a hidden staging directory, and promotes the completed project
transactionally. It never overwrites an existing destination or presents a
partially extracted project as successful.

## Source ZIP

**Export Source ZIP** uses the same safe, font-free source collector but omits
the version contract and generated project manifest. Use it for a lightweight
source snapshot, not a reproducible Typsastra interchange promise.

See the [project format reference](../TYPSASTRA_PROJECT_FORMAT.md).
