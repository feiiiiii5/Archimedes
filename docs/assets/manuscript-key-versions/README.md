# Manuscript key versions evidence

Both images render the actual `PaperWritingView` at 1440×1000, Charcoal and
English, with the same single-file manuscript and controlled bridge fixture.

- `before.png` uses the prerequisite base `ea87334`: the Writing toolbar has no
  key-version action.
- `after.png` uses this PR: **Key versions** opens the actual dialog, saves
  "First complete draft", then compares it with a changed `main.tex`. The
  dialog shows the added line, its diff and the restore action.

The bridge returns a deterministic file list and version record for the
capture; save/compare/restore against real filesystem bytes, SQLite ownership
and command handlers are covered by `electron/paper-writing-history.test.cjs`
and the focused Writing component test.
