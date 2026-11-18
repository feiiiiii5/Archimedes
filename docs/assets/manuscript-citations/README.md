# Manuscript reference evidence

`before.png` and `after.png` are direct 1440×1000 browser content captures,
using the same Charcoal theme, English language and synthetic main/section/
bibliography files. Before runs the actual prerequisite base `ff5f0c4`
(existing-manuscript and bibliography-interchange changes); after runs this
branch. Both show the saved main document with auto compile off and no build.
The added **Insert citation** toolbar action is the visual difference.

`dialog.png`, `inserted.png` and `updated.png` show the new dialog and its normal
actions. The fixture uses a real filesystem and SQLite project library via a
local desktop-bridge harness, not a fabricated completed product result.
After **Insert citation and update .bib**, the fixture's library title and year
were corrected through the existing metadata API, then **Update .bib only**
retained `evidence2026` and the one existing citation. The handwritten book entry
and its note remained intact. The dialog copy uses one key/preservation hint.

The actual **Recompile** action subsequently succeeded with the managed
Tectonic engine and existing cache (342 ms on this small fixture). Its PDF was
17,078 bytes, SHA-256
`17bd7a6112eb8b8916811bbc3280b0750af317dab2d9b6a5cbeccaa155f4b13f`.
This renderer harness checks the real compile result and output file; it does
not emulate Electron's PDF URL handler.

![Before](before.png)

![After](after.png)

![Citation dialog](dialog.png)

![Metadata updated without another citation](updated.png)

## Keep bibliography annotations and external edits

These captures use the compiled macOS Electron app in the Charcoal theme at
1560 × 980. In two temporary workspaces, the same manuscript entry starts with a
handwritten DOI comment. Update its metadata, append a new reference to the
saved bibliography from outside Writing, update the original metadata again,
and open `references.bib` in Writing. The old build (`e8b8c1e`) loses both manual
changes. The new build (`260dbb0`) keeps both and preserves `fixture2026`.

| Before | After |
| --- | --- |
| [Bibliography after two updates](bibliography-refresh-before.png) | [Bibliography keeps the DOI note and added entry](bibliography-refresh-after.png) |
