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

## Restore recovery

The compiled Electron app was exercised with the same temporary three-file
manuscript in Charcoal at 1560 × 980. The before build is `284a151` and the
after build is `79196dc`. Both runs used the normal Writing toolbar, comparison,
and restore buttons with real local persistence.

| Action | Before | After |
| --- | --- | --- |
| Compare after renaming `main.tex` | [Comparison failed](missing-main-before.png) | [Comparison shows the missing main file and allows restore](missing-main-after.png) |
| Restore after replacing `z.tex` with a directory | [Restore failed after writing the earlier file](path-transition-before.png) | [Restored main and methods, with a return version](path-transition-after.png) |
