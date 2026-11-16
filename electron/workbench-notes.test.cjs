const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const notes = require("./workbench-notes.cjs");

test("workbench notes persist per key and survive reload", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "archimedes-workbench-notes-"));
  try {
    notes.initialize(directory);
    notes.saveNote("thread-1", "# Scratch\nDraft prompt");
    assert.equal(notes.getNote("thread-1").content, "# Scratch\nDraft prompt");
    assert.ok(notes.getNote("thread-1").updatedAt);

    notes.initialize(directory);
    assert.equal(notes.getNote("thread-1").content, "# Scratch\nDraft prompt");
    assert.equal(notes.getNote("thread-2").content, "");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("workbench notes clear empty content and delete explicitly", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "archimedes-workbench-notes-"));
  try {
    notes.initialize(directory);
    notes.saveNote("draft", "hello");
    notes.saveNote("draft", "   ");
    assert.equal(notes.getNote("draft").content, "");

    notes.saveNote("thread-2", "keep");
    assert.deepEqual(notes.deleteNote("thread-2"), { deleted: true });
    assert.deepEqual(notes.deleteNote("thread-2"), { deleted: false });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("workbench notes reject empty keys", () => {
  assert.throws(() => notes.saveNote("", "content"), /note key/i);
  assert.throws(() => notes.getNote("   "), /note key/i);
});

test("owned notes claim legacy content once and keep same-ID folders isolated after reload", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "archimedes-owned-notes-"));
  try {
    notes.initialize(directory);
    notes.saveNote("same-thread", "Existing thread note");
    const a = `owner:thread:${JSON.stringify(["/data/a", "same-thread"])}`;
    const b = `owner:thread:${JSON.stringify(["/data/b", "same-thread"])}`;
    assert.equal(notes.getNote(a).content, "Existing thread note");
    assert.equal(notes.getNote(b).content, "");
    assert.equal(notes.getNote("same-thread").content, "");
    notes.saveNote(b, "B note");
    notes.saveNote("draft:/data/a", "Existing unsent note");
    const newA = `owner:new:${JSON.stringify(["/data/a", "project-a", "workspace-a", "/execution/a"])}`;
    const newB = `owner:new:${JSON.stringify(["/data/a", "project-b", "workspace-b", "/execution/b"])}`;
    assert.equal(notes.getNote(newA).content, "Existing unsent note");
    assert.equal(notes.getNote(newB).content, "");
    const longRoot = `/research/${"nested/".repeat(40)}`;
    const longA = `owner:thread:${JSON.stringify([longRoot, "a"])}`, longB = `owner:thread:${JSON.stringify([longRoot, "b"])}`;
    notes.saveNote(longA, "Long A"); notes.saveNote(longB, "Long B");
    notes.initialize(directory);
    assert.equal(notes.getNote(a).content, "Existing thread note");
    assert.equal(notes.getNote(b).content, "B note");
    assert.equal(notes.getNote(newA).content, "Existing unsent note");
    assert.equal(notes.getNote(longA).content, "Long A");
    assert.equal(notes.getNote(longB).content, "Long B");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
