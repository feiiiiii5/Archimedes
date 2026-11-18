const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const store = require("./store.cjs");

async function actualAppFunction(name, scope) {
  const filename = path.join(__dirname, "../src/App.tsx"), source = fs.readFileSync(filename, "utf8");
  const start = source.indexOf(`  async function ${name}(`), end = source.indexOf("\n  }\n", start) + 4;
  assert.ok(start >= 0 && end > start, `Actual App callback ${name}`);
  const { transformWithOxc } = await import("vite");
  const { code } = await transformWithOxc(source.slice(start, end), "callback.ts", {});
  return new Function(...Object.keys(scope), `${code}\nreturn ${name};`)(...Object.values(scope));
}
function deferred() { let resolve; const promise = new Promise((value) => { resolve = value; }); return { promise, resolve }; }
async function fixture(t) {
  const task = await import("../src/task-selection.ts");
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "archimedes-manuscript-ui-")));
  const dataRoot = path.join(root, "data"), oldRoot = path.join(root, "old-source"), newRoot = path.join(root, "new-target");
  for (const directory of [dataRoot, oldRoot, newRoot]) fs.mkdirSync(directory);
  const database = store.createWorkspaceStore(dataRoot), project = database.createResearchProject({ name: "Manuscript", workspacePath: oldRoot });
  const workspace = database.defaultProjectWorkspace(project.id), original = database.createResearchThread({ projectId: project.id, workspaceId: workspace.id, mode: "free-chat", visibility: "private", title: "Original research task" });
  fs.mkdirSync(path.join(oldRoot, "paper")); fs.writeFileSync(path.join(oldRoot, "paper/main.tex"), "\\input{section}\n"); fs.writeFileSync(path.join(oldRoot, "paper/section.tex"), "Actual original manuscript\n");
  const build = await require("./latex-workspace.cjs").compileLatexDocument(oldRoot, "paper/main.tex", { executable: "tectonic", spawnImpl: (_command, args) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    queueMicrotask(() => { fs.writeFileSync(path.join(args[args.indexOf("--outdir") + 1], "main.pdf"), "%PDF-controlled-UI-workflow\n"); child.emit("close", 0, null); }); return child;
  } });
  assert.equal(build.ok, true);
  database.setResearchProjectWorkspace(project.id, newRoot);
  const workspaces = database.listProjectWorkspaces(project.id), selection = task.threadTaskSelection(dataRoot, original, workspaces);
  const origin = { dataRoot, projectId: project.id, workspaceId: workspace.id, threadId: original.id, workspace: oldRoot, mainPath: "paper/main.tex", selectedPath: "paper/section.tex", manifestPath: build.source_snapshot.manifest_path, sourceVersion: build.source_snapshot.requested_source.source_version, pdfPath: build.source_snapshot.pdf.path, pdfSha256: build.source_snapshot.pdf.sha256, buildId: build.source_snapshot.build_id };
  const drafts = new Map([[task.taskDraftKey(selection), { text: "ORIGINAL_UNSENT_PLAN", selectionStart: 0, selectionEnd: 0 }]]), contexts = new Map(), settings = new Map(), sent = [], shown = [];
  let threads = [];
  const scope = { ...task, t: (value) => value, workspaces, dataFolderLoadingRef: { current: false }, taskSelectionRef: { current: selection }, activeRunRef: { current: null }, commandLockRef: { current: false }, threadOpenRequestRef: { current: 0 }, reasoningEffort: "medium", contextLength: "standard", threadVisibility: "project",
    manuscriptChatsRef: { current: new Map() }, window: { localStorage: { getItem: (key) => settings.get(key) ?? null, setItem: (key, value) => settings.set(key, value) } },
    readComposerDraft: (key) => drafts.get(key) ?? null, writeComposerDraft: (key, value) => drafts.set(key, value), appendComposerText: (first, next) => first ? `${first}\n\n${next}` : next,
    queueComposerText: (key, text) => { const old = drafts.get(key)?.text || ""; drafts.set(key, { text: old ? `${old}\n\n${text}` : text }); },
    setContextItems: (update, key) => contexts.set(key, update(contexts.get(key) || [])),
    setThreads: (update) => { threads = update(threads); }, setMainSection: (section) => shown.push(section),
    submitPrompt: async (...args) => { sent.push({ selection: scope.taskSelectionRef.current, args }); return true; },
    desktopBridge: { createResearchThread: async (input) => database.createResearchThread(input), getResearchThread: async (id) => database.getResearchThread(id) },
    displayThread: (thread, data) => { scope.taskSelectionRef.current = task.threadTaskSelection(data, thread, workspaces); },
  };
  t.after(() => { database.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { ...task, scope, database, project, workspace, root, dataRoot, oldRoot, newRoot, origin, selection, drafts, contexts, sent, shown };
}

test("owner-only review feedback stays private after its source is shared, and archived revisions are replaced", async (t) => {
  const f = await fixture(t), open = await actualAppFunction("openManuscriptChat", f.scope);
  const openShared = { ...f.origin, threadId: null };
  await open(openShared, "PROJECT_REVISION_DRAFT", "revision");
  const shared = f.scope.taskSelectionRef.current;
  assert.equal(f.database.getResearchThread(shared.threadId).visibility, "project");
  f.scope.taskSelectionRef.current = f.selection;
  f.scope.openManuscriptChat = open;
  const revise = await actualAppFunction("draftManuscriptRevision", f.scope);
  f.database.setResearchThreadVisibility(f.selection.threadId, "project");
  const sharedSource = f.database.getResearchThread(f.selection.threadId);
  const privateReceipt = { ...f.origin, privateOwnerId: sharedSource.owner_id };
  await revise({ id: "reviewed-run", manuscript: privateReceipt }, [{ text: "Selected feedback", page: 3, quote: "Original evidence", severity: "major" }]);
  const first = f.scope.taskSelectionRef.current, key = f.taskDraftKey(first), thread = f.database.getResearchThread(first.threadId);
  assert.equal(first.executionRoot, f.oldRoot); assert.notEqual(first.threadId, f.selection.threadId); assert.equal(thread.based_on_thread_id, f.selection.threadId); assert.equal(thread.turns.length, 0);
  assert.equal(thread.visibility, "private");
  assert.notEqual(first.threadId, shared.threadId);
  assert.equal(f.drafts.get(f.taskDraftKey(shared)).text, "PROJECT_REVISION_DRAFT");
  f.drafts.set(key, { text: "USER_REVISION_NOTES\n" + f.drafts.get(key).text });
  await open(privateReceipt, "A second selected finding", "revision");
  assert.equal(f.scope.taskSelectionRef.current.threadId, first.threadId);
  assert.match(f.drafts.get(key).text, /^USER_REVISION_NOTES/); assert.match(f.drafts.get(key).text, /A second selected finding/);
  assert.equal(f.drafts.get(f.taskDraftKey(f.selection)).text, "ORIGINAL_UNSENT_PLAN");
  assert.match(f.drafts.get(key).text, /Review run: reviewed-run/);
  assert.match(f.drafts.get(key).text, /PDF page: 3/);
  assert.match(f.drafts.get(key).text, /Original evidence/);
  const opened = []; f.scope.setPaperOpenRequest = value => opened.push(value);
  const returnToSource = await actualAppFunction("returnToManuscript", f.scope);
  await returnToSource(f.origin);
  assert.equal(f.scope.taskSelectionRef.current.threadId, f.origin.threadId);
  assert.equal(f.scope.taskSelectionRef.current.executionRoot, f.oldRoot);
  assert.equal(opened[0].path, "paper/section.tex");
  assert.equal(f.contexts.get(key).length, 1); assert.ok(f.contexts.get(key)[0].path.startsWith(f.oldRoot + path.sep));

  f.database.archiveResearchThread(first.threadId);
  await open(privateReceipt, "A finding after archiving", "revision");
  const replacement = f.scope.taskSelectionRef.current;
  assert.notEqual(replacement.threadId, first.threadId);
  const replacementThread = f.database.getResearchThread(replacement.threadId);
  assert.equal(replacementThread.archived_at, null);
  assert.equal(replacementThread.visibility, "private");
  assert.equal(f.drafts.get(f.taskDraftKey(replacement)).text, "A finding after archiving");
  assert.match(f.drafts.get(key).text, /^USER_REVISION_NOTES/);

  f.database.deleteResearchThread(f.selection.threadId);
  await open(privateReceipt, "A finding after source deletion", "revision");
  assert.equal(f.scope.taskSelectionRef.current.threadId, replacement.threadId);
  assert.match(f.drafts.get(f.taskDraftKey(replacement)).text, /A finding after source deletion/);

  f.database.archiveResearchThread(replacement.threadId);
  f.database.setResearchProjectWorkspace(f.project.id, f.oldRoot);
  f.scope.workspaces = f.database.listProjectWorkspaces(f.project.id);
  await open(privateReceipt, "A new revision without the source chat", "revision");
  const withoutSource = f.database.getResearchThread(f.scope.taskSelectionRef.current.threadId);
  assert.notEqual(withoutSource.id, replacement.threadId);
  assert.equal(withoutSource.visibility, "private");
  assert.equal(withoutSource.based_on_thread_id, null);
});
