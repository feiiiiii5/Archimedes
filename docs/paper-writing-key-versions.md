# Manuscript key versions

Choose **Key versions** in the writing toolbar, give the current manuscript a
name such as “First complete draft”, and save it. Archimedes first saves open
source drafts through their existing owner queues. A key version then copies
the actual files in the main document's directory and descendants, including
sections, bibliographies and images. This is an explicit manuscript milestone;
it does not watch every workspace file or manage Git history.

The scope and directory exclusions follow manuscript build receipts. Generated
build folders, `.archimedes`, Git and common dependency caches are excluded.
Keep a manuscript in a dedicated folder. Symbolic-link inputs must be moved
inside the manuscript folder to save a complete restorable version. Build
receipts remain separate: they retain PDF/log hashes, whereas key versions
retain source contents.

Select a version to compare it with the saved current manuscript. The view
lists added, removed and modified files, shows text diffs, and identifies changed
binary assets. **Restore this key version** restores those saved file bytes and
removes files added since that version, as shown in the comparison. Current
content is saved as a “Before restoring …” return version. This works when the
main file was moved or removed and when a manuscript path changed from a file
to a directory or back. If the conversion would displace files outside the
comparison, restoration stops before changing the manuscript. If editing or
another program changed files after comparison, refresh the comparison first.

Restoration reloads the editor and clears the old PDF preview. Continue editing
and recompile normally; review/slides still require a fresh matching build
receipt. Restoring local source does not overwrite a shared Yjs document, so
co-editing is closed on restoration.

Version manifests and content-addressed blobs live under the execution folder's
`.archimedes/manuscript-history/`. The data workspace keeps a small owner index
so a local manuscript remains discoverable after the project's default folder
changes, even if no conversation was created. The project research index opens
a version's comparison directly. Project transfer can include **Key versions**
independently of current source files; such a version can restore a missing
manuscript explicitly after import.
