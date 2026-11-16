const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const store = require("./store.cjs");
const agent = require("./agent.cjs");
const { resolveResearchContext } = require("./workspace-context.cjs");

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "archimedes-context-")));
  const directories = Object.fromEntries(["a", "b", "executionA", "executionB", "next"].map(name => {
    const directory = path.join(root, name);
    fs.mkdirSync(directory);
    return [name, directory];
  }));
  t.after(() => { store.closeAllWorkspaces(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, ...directories };
}

test("context rejects thread/project/workspace/root mixing before any new turn and preserves historical execution", async t => {
  const roots = fixture(t);
  const owner = store.createWorkspaceStore(roots.a);
  const projectA = owner.createResearchProject({ name: "A", workspacePath: roots.executionA });
  const projectB = owner.createResearchProject({ name: "B", workspacePath: roots.executionB });
  const workspaceA = owner.defaultProjectWorkspace(projectA.id), workspaceB = owner.defaultProjectWorkspace(projectB.id);
  const thread = owner.createResearchThread({ projectId: projectA.id, workspaceId: workspaceA.id, prompt: "A", mode: "free-chat" });
  let calls = 0;
  const previous = global.fetch;
  global.fetch = async () => { calls++; throw new Error("unexpected provider traffic"); };
  t.after(() => { global.fetch = previous; });
  for (const mismatch of [
    { threadId: thread.id, projectId: projectB.id, workspace: roots.executionA },
    { threadId: thread.id, workspaceId: workspaceB.id, workspace: roots.executionA },
    { threadId: thread.id, workspace: roots.executionB },
    { projectId: projectA.id, workspaceId: workspaceB.id, workspace: roots.executionB },
  ]) await assert.rejects(agent.runAgent({ dataStore: owner, prompt: "Do not run", ...mismatch }), /belong|match/);
  assert.equal(calls, 0);
  assert.equal(owner.getSnapshot().tasks.length, 0);
  assert.equal(owner.getResearchThread(thread.id).turns.length, 0);
  owner.setResearchProjectWorkspace(projectA.id, roots.next);
  const historical = resolveResearchContext(owner, { threadId: thread.id, projectId: projectA.id, workspaceId: workspaceA.id, workspace: roots.executionA });
  assert.equal(historical.workspace, roots.executionA);
  assert.equal(historical.dataRoot, roots.a);
  assert.equal(resolveResearchContext(owner, { projectId: projectA.id }).workspace, roots.next);
});

test("opening a freshly imported conversation binds the same local context used by run and remains readable to viewers", async t => {
  const roots = fixture(t);
  const owner = store.createWorkspaceStore(roots.a);
  const project = owner.createResearchProject({ name: "Imported into a separate folder", workspacePath: roots.executionA });
  owner.applyCloudThread(project.id, { thread: { id: "import-after-open", title: "Imported", status: "idle" }, turns: [] });
  const opened = owner.getResearchThread("import-after-open");
  assert.equal(opened.workspace_path, roots.executionA);
  assert.equal(opened.workspace_id, owner.defaultProjectWorkspace(project.id).id);
  const context = resolveResearchContext(owner, { threadId: opened.id, projectId: opened.project_id, workspaceId: opened.workspace_id, workspace: opened.workspace_path });
  assert.equal(context.workspace, opened.workspace_path);
  assert.equal(context.workspaceId, opened.workspace_id);
  owner.setResearchProjectWorkspace(project.id, roots.next);
  assert.equal(owner.getResearchThread(opened.id).workspace_path, roots.executionA, "local binding must not follow later project changes");
  assert.equal(resolveResearchContext(owner, { threadId: opened.id }).workspace, roots.executionA);

  owner.applyCloudThread(project.id, { thread: { id: "viewer-import", title: "Readable history", status: "idle" }, turns: [] });
  owner.addProjectMember({ projectId: project.id, userId: "context-viewer", role: "viewer" });
  store.setLocalIdentity({ userId: "context-viewer", displayName: "Viewer" });
  try {
    const viewed = owner.getResearchThread("viewer-import");
    assert.equal(viewed.workspace_path, roots.next);
    assert.equal(viewed.workspace_id, owner.defaultProjectWorkspace(project.id).id);
    await assert.rejects(agent.runAgent({ dataStore: owner, threadId: viewed.id, projectId: project.id, workspaceId: viewed.workspace_id, workspace: viewed.workspace_path, prompt: "Must not execute as viewer" }), /access/);
    assert.equal(owner.getSnapshot().tasks.length, 0);
  } finally {
    store.setLocalIdentity({ userId: "local-user", displayName: "Local user", deviceId: "local-device", deviceName: "This device" });
  }
});

