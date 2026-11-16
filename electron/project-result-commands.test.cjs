const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const store = require("./store.cjs");
const { createWorkspaceIpc } = require("./workspace-context.cjs");
const { registerProjectResultCommands } = require("./project-result-commands.cjs");
const { registerThreadCommands } = require("./thread-commands.cjs");

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "archimedes-result-commands-")));
  const roots = Object.fromEntries(["data", "other", "execution", "next"].map(name => {
    const folder = path.join(root, name); fs.mkdirSync(folder); return [name, folder];
  }));
  const owner = store.createWorkspaceStore(roots.data), other = store.createWorkspaceStore(roots.other);
  const project = owner.createResearchProject({ name: "Result owner", workspacePath: roots.execution });
  const workspace = owner.defaultProjectWorkspace(project.id);
  let selected = roots.data, bridge;
  const handlers = new Map();
  const ipcMain = createWorkspaceIpc({ ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) }, store, workspaceForEvent: () => selected });
  registerProjectResultCommands({ ipcMain, store });
  registerThreadCommands({ ipcMain, store, dataWorkspace: () => selected });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "preload.cjs"), "utf8"), { process, require(name) {
    assert.equal(name, "electron");
    return { contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } }, ipcRenderer: {
      invoke: (channel, input) => Promise.resolve().then(() => handlers.get(channel)({ sender: { id: 1 } }, input)),
    } };
  } });
  t.after(() => { store.closeAllWorkspaces(); fs.rmSync(root, { recursive: true, force: true }); });
  const input = { projectId: project.id, workspaceId: workspace.id, kind: "analysis", title: "Real CSV", manifest: { version: 1, source: { file: "source.csv" } }, files: [
    { name: "source.csv", role: "source", encoding: "utf8", content: "x,y\n1,2\n" },
    { name: "plot.svg", role: "output", encoding: "utf8", content: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
  ] };
  return { root, ...roots, owner, other, project, workspace, bridge, input, select: value => { selected = value; } };
}

test("real bridge saves to the canonical project root, registers only actual sessions, and cannot cross data stores", async t => {
  const f = fixture(t);
  const saved = await f.bridge.saveProjectResult({ ...f.input, executionRoot: f.other });
  assert.equal(saved.executionRoot, f.execution);
  assert.equal(saved.threadId, null);
  assert.equal(f.owner.listProjectThreadsForSync(f.project.id).length, 0, "saving a figure/analysis must not invent a conversation");
  assert.equal(fs.existsSync(path.join(f.data, "research-results")), false);
  assert.equal(fs.readFileSync(path.join(f.execution, saved.files[0].path), "utf8"), f.input.files[0].content);
  const thread = f.owner.createResearchThread({ projectId: f.project.id, workspaceId: f.workspace.id, prompt: "Analyse full source", mode: "free-chat" });
  const linked = await f.bridge.saveProjectResult({ ...f.input, id: saved.id, threadId: thread.id });
  assert.equal(linked.threadId, thread.id);
  assert.deepEqual(f.owner.listArtifacts(thread.id).map(file => file.path).sort(), linked.files.map(file => file.path).sort());
  assert.ok((await f.bridge.getProjectResult(saved.id)).files.every(file => !("content" in file)));
  assert.equal((await f.bridge.readProjectResultFile(saved.id, "source.csv")).content, f.input.files[0].content);
  f.select(f.other.workspace);
  await assert.rejects(f.bridge.getProjectResult(saved.id), /not found/);
  assert.equal(f.other.listProjectResultRecords({ projectId: f.other.defaultResearchProject().id }).length, 0);
});

test("updates retain historical roots, validate session ownership before writes, and survive session deletion/reopen", async t => {
  const f = fixture(t), saved = await f.bridge.saveProjectResult(f.input);
  const thread = f.owner.createResearchThread({ projectId: f.project.id, workspaceId: f.workspace.id, prompt: "Original context", mode: "free-chat" });
  f.owner.setResearchProjectWorkspace(f.project.id, f.next);
  const nextThread = f.owner.createResearchThread({ projectId: f.project.id, workspaceId: f.workspace.id, prompt: "New folder", mode: "free-chat" });
  await assert.rejects(f.bridge.saveProjectResult({ ...f.input, id: saved.id, threadId: nextThread.id }), /linked session/);
  const linked = await f.bridge.saveProjectResult({ ...f.input, id: saved.id, threadId: thread.id, title: "Historical output" });
  assert.equal(linked.executionRoot, f.execution);
  assert.equal(fs.existsSync(path.join(f.next, "research-results")), false);
  f.owner.deleteResearchThread(thread.id);
  f.owner.close();
  const reopened = store.createWorkspaceStore(f.data);
  assert.equal(reopened.getProjectResultRecord(saved.id).threadId, null);
  assert.equal((await f.bridge.getProjectResult(saved.id)).threadId, null);
  assert.equal((await f.bridge.listProjectResults({ projectId: f.project.id }))[0].title, "Historical output");
});

test("viewers can reopen result files and see changed hashes but cannot save or inject credentials", async t => {
  const f = fixture(t), saved = await f.bridge.saveProjectResult(f.input);
  await assert.rejects(f.bridge.saveProjectResult({ ...f.input, manifest: { apiKey: "fake-must-not-save" } }), /without credentials/);
  f.owner.addProjectMember({ projectId: f.project.id, userId: "result-viewer", role: "viewer" });
  store.setLocalIdentity({ userId: "result-viewer", displayName: "Viewer" });
  try {
    assert.equal((await f.bridge.getProjectResult(saved.id)).fileState, "ready");
    await assert.rejects(f.bridge.saveProjectResult({ ...f.input, id: saved.id }), /permission/);
    fs.writeFileSync(path.join(f.execution, saved.files[0].path), "changed input\n");
    const changed = await f.bridge.readProjectResultFile(saved.id, "source.csv");
    assert.equal(changed.fileState, "changed"); assert.notEqual(changed.sha256, changed.actualSha256);
    await assert.rejects(f.bridge.readProjectResultFile(saved.id, "../unregistered.csv"), /filename|registered/);
  } finally { store.setLocalIdentity({ userId: "local-user", displayName: "Local user", deviceId: "local-device", deviceName: "This device" }); }
});



test("an analysis result creates a persisted discussion in its original registered folder", async t => {
  const f = fixture(t), saved = await f.bridge.saveProjectResult(f.input);
  f.owner.setResearchProjectWorkspace(f.project.id, f.next);
  const thread = await f.bridge.createResearchThread({ basedOnResultId: saved.id, projectId: f.project.id, workspaceId: f.workspace.id, workspacePath: f.execution, title: "Continue the saved analysis" });
  assert.equal(thread.workspace_path, f.execution);
  assert.equal(thread.based_on_result_id, saved.id);
  const manifestBeforeLink = fs.readFileSync(path.join(f.execution, saved.manifestPath), "utf8");
  const linked = await f.bridge.linkProjectResultThread(saved.id, thread.id);
  assert.equal(linked.threadId, thread.id);
  assert.equal(fs.readFileSync(path.join(f.execution, saved.manifestPath), "utf8"), manifestBeforeLink);
  assert.deepEqual(linked.files, saved.files);
  await assert.rejects(f.bridge.createResearchThread({ basedOnResultId: saved.id, projectId: f.project.id, workspaceId: f.workspace.id, workspacePath: f.next }), /execution folder/);
  f.owner.close();
  const reopened = store.createWorkspaceStore(f.data);
  assert.equal(reopened.getResearchThread(thread.id).based_on_result_id, saved.id);
});

test("complete accepted CSV sources above the old read cap remain available to workspace tools", async t => {
  const f = fixture(t), content = "label,value\n" + "x".repeat(9 * 1024 * 1024) + ",2\nlast,3\n";
  const saved = await f.bridge.saveProjectResult({ ...f.input, files: [{ name: "source.csv", role: "source", encoding: "utf8", content }] });
  const source = saved.files[0];
  assert.equal(require("./workspace-files.cjs").readWorkspaceFile(f.execution, source.path).content, content);
  assert.match(require("./agent/workspace-tools.cjs").readLines(f.execution, source.path, 3, 3).content, /last,3/);
});
