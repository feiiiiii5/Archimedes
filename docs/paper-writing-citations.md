# Citations from the project library

Open a manuscript's `.tex` source and choose **Insert citation** in the editor
toolbar. Search the current project's libraries by title, author, year, DOI or
key. Select the manuscript `.bib` path; a missing file is created when you
explicitly update it. Paths stay inside the selected main document's folder.

- **Insert citation and update .bib** saves the selected bibliography entry and
  inserts `\cite{key}` at the source cursor.
- **Update .bib only** refreshes metadata without inserting another citation.
- **Insert citation only** keeps the bibliography file as written.

An existing matching paper keeps the citation key already used by the
manuscript. New entries use the library key, or a stable paper-ID key when none
has been assigned. If another paper already occupies that key, a suffix is
chosen. A small comment associates an updated entry with its library paper so
later metadata corrections retain the same manuscript key.

Updating changes only metadata supplied by the selected library paper. Other
entries, comments, directives, hand-written fields and existing `\cite` calls
remain in place. Existing `journal`/`booktitle` choice is preserved. The parser
supports ordinary literal BibTeX interchange; it does not evaluate arbitrary
BibTeX string expressions or TeX citation macros.

All writes use the existing manuscript owner's save queue, including a `.bib`
with unsaved edits. Bibliography inclusion commands are not added automatically:
use the manuscript's existing `\bibliography{...}` or `\addbibresource{...}`
setup, then recompile to refresh the preview.
