const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const library = require("./store.cjs");
const reviews = require("./paper-review-store.cjs");
const { compileLatexDocument } = require("./latex-workspace.cjs");
const { verifyManuscriptOrigin } = require("./manuscript-handoff.cjs");
const { stageManuscriptPdf } = require("./paper-to-slides.cjs");

function deferred() { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; }
async function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "archimedes-handoff-")));
  const data = path.join(root, "data"), source = path.join(root, "source"), target = path.join(root, "target");
  for (const directory of [data, source, target]) fs.mkdirSync(directory);
  const owner = library.createWorkspaceStore(data), project = owner.createResearchProject({ name: "Manuscript", workspacePath: source });
  const workspace = owner.defaultProjectWorkspace(project.id);
  const thread = owner.createResearchThread({ projectId: project.id, workspaceId: workspace.id, mode: "free-chat", prompt: "Source manuscript" });
  fs.mkdirSync(path.join(source, "paper")); fs.writeFileSync(path.join(source, "paper/main.tex"), "\\input{section}\n"); fs.writeFileSync(path.join(source, "paper/section.tex"), "Actual input\n");
  const compiled = await compileLatexDocument(source, "paper/main.tex", { executable: "tectonic", spawnImpl(_command, args) {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    queueMicrotask(() => { fs.writeFileSync(path.join(args[args.indexOf("--outdir") + 1], "main.pdf"), "%PDF-1.7\ncontrolled consumer fixture\n"); child.emit("close", 0, null); });
    return child;
  } });
  assert.equal(compiled.ok, true);
  const build = compiled.source_snapshot;
  const origin = { dataRoot: data, projectId: project.id, workspaceId: workspace.id, threadId: thread.id, workspace: source,
    mainPath: "paper/main.tex", selectedPath: "paper/section.tex", manifestPath: build.manifest_path,
    sourceVersion: build.requested_source.source_version, pdfPath: build.pdf.path, pdfSha256: build.pdf.sha256, buildId: build.build_id };
  const marker = path.join(source, path.dirname(build.manifest_path), "retained-inputs.json");
  t.after(() => { reviews.close(); library.closeAllWorkspaces(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, data, source, target, owner, project, workspace, thread, origin, marker };
}

test("slides copy a historical manuscript to the real target session root with a durable source receipt and reject other projects", async t => {
  const f = await fixture(t);
  f.owner.setResearchProjectWorkspace(f.project.id, f.target);
  const slides = f.owner.createResearchThread({ projectId: f.project.id, workspaceId: f.workspace.id, prompt: "Slides", mode: "free-chat" });
  const pdf = path.join(f.source, f.origin.pdfPath);
  const staged = stageManuscriptPdf(f.owner, f.target, pdf, { manuscript: f.origin, threadId: slides.id });
  assert.ok(staged.startsWith(`${f.target}${path.sep}`)); assert.deepEqual(fs.readFileSync(staged), fs.readFileSync(pdf));
  const receipt = JSON.parse(fs.readFileSync(path.join(path.dirname(staged), "manuscript-origin.json")));
  assert.equal(receipt.origin.workspace, f.source); assert.equal(receipt.target.executionRoot, f.target); assert.equal(receipt.target.threadId, slides.id);
  assert.ok(JSON.parse(fs.readFileSync(f.marker)).some(reference => reference.run_id === slides.id && reference.kind === "paper-to-slides"));
  const other = f.owner.createResearchProject({ name: "Other", workspacePath: f.target });
  const otherThread = f.owner.createResearchThread({ projectId: other.id, prompt: "Other", mode: "free-chat" });
  assert.throws(() => stageManuscriptPdf(f.owner, f.target, pdf, { manuscript: f.origin, threadId: otherThread.id }), /another manuscript project/);
  assert.throws(() => stageManuscriptPdf(f.owner, f.target, pdf, { manuscript: { ...f.origin, dataRoot: f.target }, threadId: slides.id }), /another data workspace/);
});

