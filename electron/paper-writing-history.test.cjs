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
