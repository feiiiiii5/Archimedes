const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const history = require("./paper-writing-history.cjs");
const { registerPaperWritingCommands } = require("./paper-writing-commands.cjs");
const { compileLatexDocument } = require("./latex-workspace.cjs");
const { createWorkspaceStore } = require("./store.cjs");

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "archimedes-key-versions-")));
  fs.mkdirSync(path.join(root, "paper/sections"), { recursive: true });
  fs.writeFileSync(path.join(root, "paper/main.tex"), "\\documentclass{article}\n\\begin{document}\n\\input{sections/body}\n\\end{document}\n");
  fs.writeFileSync(path.join(root, "paper/sections/body.tex"), "Original evidence.\n");
  fs.writeFileSync(path.join(root, "paper/refs.bib"), "@article{stable, title={Original metadata}, year={2026}}\n");
  fs.writeFileSync(path.join(root, "paper/plot.png"), Buffer.from([137, 80, 78, 71]));
  const store = createWorkspaceStore(root), project = store.createResearchProject({ name: "Versioned manuscript", workspacePath: root });
  const workspace = store.defaultProjectWorkspace(project.id);
  const owner = { dataRoot: root, executionRoot: root, projectId: project.id, workspaceId: workspace.id, mainPath: "paper/main.tex" };
  const handlers = new Map(); registerPaperWritingCommands({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, store });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const command = (action, input = {}) => handlers.get(`paper-writing:versions:${action}`)({}, { ...owner, ...input });
  return { root, owner, store, command };
}

test("named multi-file version compares, restores, preserves a return point and compiles continued edits", async t => {
  const f = fixture(t), first = f.command("save", { name: "Complete first argument" });
  assert.equal(first.files.length, 4);
  fs.writeFileSync(path.join(f.root, "paper/sections/body.tex"), "Revised evidence.\n");
  fs.writeFileSync(path.join(f.root, "paper/refs.bib"), "@article{stable, title={Updated metadata}, year={2026}}\n");
  fs.writeFileSync(path.join(f.root, "paper/plot.png"), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(f.root, "paper/extra.tex"), "An added section.\n");
  const comparison = f.command("compare", { id: first.id });
  assert.deepEqual(comparison.changes.map(file => [file.path, file.status]), [["paper/extra.tex", "added"], ["paper/plot.png", "modified"], ["paper/refs.bib", "modified"], ["paper/sections/body.tex", "modified"]]);
  assert.match(comparison.changes.at(-1).patch, /-Original evidence\./);
  assert.equal(comparison.changes[1].binary, true);
  const restored = f.command("restore", { id: first.id, expectedSourceVersion: comparison.currentSourceVersion });
  assert.ok(restored.previousVersion.id);
  assert.equal(fs.readFileSync(path.join(f.root, "paper/sections/body.tex"), "utf8"), "Original evidence.\n");
  assert.equal(fs.existsSync(path.join(f.root, "paper/extra.tex")), false);
  assert.equal(f.command("compare", { id: first.id }).changes.length, 0);
  assert.equal(f.command("list").length, 2);
  assert.ok(f.command("compare", { id: restored.previousVersion.id }).changes.some(file => file.path === "paper/extra.tex" && file.status === "removed"));
  fs.appendFileSync(path.join(f.root, "paper/sections/body.tex"), "Continued after restoration.\n");
  const executable = require("./latex-workspace.cjs").findExecutable(["tectonic", "/opt/homebrew/bin/tectonic", "latexmk", "pdflatex"]);
  await t.test("restored and continued manuscript compiles with an installed TeX engine", { skip: !executable && "Install TeX or Tectonic for the real compiler acceptance path." }, async () => {
    const compiled = await compileLatexDocument(f.root, "paper/main.tex", { executable });
    assert.equal(compiled.ok, true, compiled.log);
    assert.equal(compiled.source_snapshot.status, "current");
    assert.match(fs.readFileSync(path.join(f.root, compiled.pdf_path), "ascii").slice(0, 5), /%PDF-/);
  });
  assert.equal(f.command("list").length, 2, "compiler receipts do not become key versions");
});

test("comparison is refreshed for changed disk content, and commands keep project ownership", t => {
  const f = fixture(t), saved = f.command("save", { name: "Before edits" });
  const comparison = f.command("compare", { id: saved.id });
  fs.appendFileSync(path.join(f.root, "paper/sections/body.tex"), "External saved edit.\n");
  assert.throws(() => f.command("restore", { id: saved.id, expectedSourceVersion: comparison.currentSourceVersion }), /changed after this comparison/);
  const other = f.store.createResearchProject({ name: "Other" });
  assert.throws(() => f.command("compare", { id: saved.id, projectId: other.id }), /does not belong/);
});

test("a manuscript saved without a conversation remains owned and usable after the default folder moves", t => {
  const f = fixture(t), saved = f.command("save", { name: "Local writing milestone" });
  const next = path.join(f.root, "new-default"); fs.mkdirSync(next);
  f.store.setResearchProjectWorkspace(f.owner.projectId, next);
  assert.equal(history.listProjectManuscriptVersionOwners({ dataRoot: f.root, projectId: f.owner.projectId })[0].executionRoot, f.root);
  fs.appendFileSync(path.join(f.root, "paper/sections/body.tex"), "Edit in the historical manuscript folder.\n");
  const comparison = f.command("compare", { id: saved.id });
  assert.ok(comparison.changes.length);
  f.command("restore", { id: saved.id, expectedSourceVersion: comparison.currentSourceVersion });
  assert.equal(f.command("compare", { id: saved.id }).changes.length, 0);
  assert.equal(f.command("save", { name: "Continue in original folder", threadId: "unknown-thread" }).threadId, null, "a renderer cannot attach an unrelated thread through historical-owner recovery");
  assert.throws(() => f.command("list", { mainPath: "unregistered/main.tex" }), /does not match/);
});

test("a key version restores a missing main file and a missing manuscript folder", t => {
  const f = fixture(t), saved = f.command("save", { name: "Before moving sources" });
  const main = path.join(f.root, "paper/main.tex");
  const original = fs.readFileSync(main);
  fs.renameSync(main, path.join(f.root, "paper/renamed.tex"));
  let comparison = f.command("compare", { id: saved.id });
  assert.deepEqual(comparison.changes.map(({ path, status }) => [path, status]), [["paper/main.tex", "removed"], ["paper/renamed.tex", "added"]]);
  const restored = f.command("restore", { id: saved.id, expectedSourceVersion: comparison.currentSourceVersion });
  assert.deepEqual(fs.readFileSync(main), original);
  assert.ok(restored.previousVersion.files.some(file => file.path === "paper/renamed.tex"));
  fs.renameSync(path.join(f.root, "paper"), path.join(f.root, "moved-paper"));
  comparison = f.command("compare", { id: saved.id });
  assert.equal(comparison.changes.length, saved.files.length);
  f.command("restore", { id: saved.id, expectedSourceVersion: comparison.currentSourceVersion });
  assert.deepEqual(fs.readFileSync(main), original);
  assert.deepEqual(fs.readFileSync(path.join(f.root, "moved-paper/main.tex")), original);
});

test("restoration swaps files and directories in both directions and keeps a usable return point", t => {
  const f = fixture(t);
  const file = name => path.join(f.root, "paper", name);
  fs.writeFileSync(file("z.tex"), "Original standalone file");
  const originalMain = fs.readFileSync(file("main.tex"));
  const saved = f.command("save", { name: "Before restructuring" });
  fs.unlinkSync(file("main.tex"));
  fs.mkdirSync(file("main.tex"));
  fs.writeFileSync(file("main.tex/fragment.tex"), "Current main folder contents");
  fs.unlinkSync(file("z.tex"));
  fs.mkdirSync(file("z.tex"));
  fs.writeFileSync(file("z.tex/fragment.tex"), "Current standalone folder contents");
  fs.rmSync(file("sections"), { recursive: true });
  fs.writeFileSync(file("sections"), "Current standalone sections file");
  const comparison = f.command("compare", { id: saved.id });
  const restored = f.command("restore", { id: saved.id, expectedSourceVersion: comparison.currentSourceVersion });
  assert.deepEqual(fs.readFileSync(file("main.tex")), originalMain);
  assert.equal(fs.readFileSync(file("z.tex"), "utf8"), "Original standalone file");
  assert.equal(fs.readFileSync(file("sections/body.tex"), "utf8"), "Original evidence.\n");
  assert.equal(f.command("compare", { id: saved.id }).changes.length, 0);
  assert.ok(restored.previousVersion.id);
  const back = f.command("compare", { id: restored.previousVersion.id });
  f.command("restore", { id: restored.previousVersion.id, expectedSourceVersion: back.currentSourceVersion });
  assert.equal(fs.readFileSync(file("main.tex/fragment.tex"), "utf8"), "Current main folder contents");
  assert.equal(fs.readFileSync(file("z.tex/fragment.tex"), "utf8"), "Current standalone folder contents");
  assert.equal(fs.readFileSync(file("sections"), "utf8"), "Current standalone sections file");
});

test("a blocking directory with excluded files leaves the current manuscript untouched", t => {
  const f = fixture(t), file = name => path.join(f.root, "paper", name);
  fs.writeFileSync(file("z.tex"), "Saved file");
  const saved = f.command("save", { name: "Saved before changing layout" });
  fs.writeFileSync(file("main.tex"), "Current main file");
  fs.unlinkSync(file("z.tex"));
  fs.mkdirSync(file("z.tex/.cache"), { recursive: true });
  fs.writeFileSync(file("z.tex/fragment.tex"), "Current fragment");
  fs.writeFileSync(file("z.tex/.cache/retained.txt"), "Excluded data");
  const comparison = f.command("compare", { id: saved.id });
  assert.throws(() => f.command("restore", { id: saved.id, expectedSourceVersion: comparison.currentSourceVersion }), /directory blocking restoration contains unsaved material/);
  assert.equal(fs.readFileSync(file("main.tex"), "utf8"), "Current main file");
  assert.equal(fs.readFileSync(file("z.tex/fragment.tex"), "utf8"), "Current fragment");
  assert.equal(fs.readFileSync(file("z.tex/.cache/retained.txt"), "utf8"), "Excluded data");
  assert.equal(f.command("list").length, 1);
});

test("an install failure after writing a restored file rolls back every changed path", t => {
  const f = fixture(t), file = name => path.join(f.root, "paper", name);
  fs.writeFileSync(file("z.tex"), "Saved standalone file");
  const saved = f.command("save", { name: "Version before restructuring" });
  fs.writeFileSync(file("main.tex"), "Current main file");
  fs.unlinkSync(file("z.tex"));
  fs.mkdirSync(file("z.tex"));
  fs.writeFileSync(file("z.tex/fragment.tex"), "Current new folder contents");
  const comparison = f.command("compare", { id: saved.id });
  const realCopy = fs.copyFileSync;
  let writtenMain = false;
  t.mock.method(fs, "copyFileSync", (from, to, flags) => {
    if (to === file("z.tex")) throw new Error("Fixture write failure");
    realCopy(from, to, flags);
    if (to === file("main.tex")) writtenMain = true;
  });
  assert.throws(() => f.command("restore", { id: saved.id, expectedSourceVersion: comparison.currentSourceVersion }), /Fixture write failure/);
  assert.equal(writtenMain, true);
  assert.equal(fs.readFileSync(file("main.tex"), "utf8"), "Current main file");
  assert.equal(fs.readFileSync(file("z.tex/fragment.tex"), "utf8"), "Current new folder contents");
});
