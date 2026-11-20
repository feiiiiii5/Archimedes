const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const test = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../src/App.tsx"), "utf8");
function extract(name) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, "m"));
  const end = source.slice(start + 1).search(/^  (?:async )?function /m);
  assert.ok(start >= 0 && end >= 0);
  return source.slice(start, start + end + 1);
}

test("new project tasks use returned records before rerender, and empty side chats forward the selected workspace", async () => {
  const helpers = await import("../src/task-selection.ts");
  const { transformWithOxc } = await import("vite");
  const project = { id: "new-project", workspace_path: "/execution/new" };
  const space = { id: "new-shared", project_id: project.id, root: project.workspace_path, is_default: true };
  const state = { selection: null, side: null, threads: [] };
  const drafts = new Map();
  const composerSessions = new Map(), queues = new Map();
  const attachmentOwners = new Map();
  let created;
  const scope = {
    ...helpers, t: value => value, threads: [], mainSection: "chat", projects: [{ id: "old-project", workspace_path: "/old" }], workspaces: [], workspace: "/data",
    newProjectName: "New project", newProjectWorkspace: project.workspace_path, agentBusy: false,
    activeRunRef: { current: null }, taskSelectionRef: { current: null }, dataFolderLoadingRef: { current: false }, threadOpenRequestRef: { current: 0 }, activeThreadIdRef: { current: null }, commandLockRef: { current: false },
    activeProjectId: "old-project", activeWorkspaceId: null, sideThread: null, researchMode: "free-chat", threadVisibility: "project", executionWorkspace: "/old", initialMessages: [],
    setProjects() {}, setWorkspaces() {}, setNewProjectName() {}, setNewProjectError() {}, setNewProjectOpen() {},
    setMainSection() {}, clearPendingAssistantDeltas() {}, setBoundHarness() {}, setThreadVisibility() {}, setMessages() {}, setTrajectoryEvents() {}, setEvents() {}, setPendingAction() {}, setContextItems() {}, setChangeSets() {}, setChatViewNonce() {}, setWorkbenchOpen() {},
    applyTaskSelection(value) { state.selection = value; scope.taskSelectionRef.current = value; },
    readComposerDraft: key => drafts.get(key),
    writeComposerDraft(key, draft) { if (draft) drafts.set(key, draft); else drafts.delete(key); return true; },
    updateComposer(key, update) { composerSessions.set(key, update(composerSessions.get(key))); },
    updateQueuedPrompts(key, queue) { queues.set(key, queue); },
    composerAttachmentOwnersRef: { current: attachmentOwners },
    setThreads(update) { state.threads = update(state.threads); }, setSideThread(value) { state.side = value; },
    desktopBridge: { createResearchProject: async () => project, listResearchWorkspaces: async () => [space], createResearchThread: async input => { created = input; return { id: "side", project_id: input.projectId, workspace_id: input.workspaceId, workspace_path: input.workspacePath }; } },
  };
  const { code } = await transformWithOxc(["openEmptyTask", "startNewTask", "createProject", "runConversationCommand", "selectProject", "selectWorkspace", "changeProjectWorkspace"].map(extract).join("\n"), "new-project-task.ts");
  const callbacks = new Function("scope", `with(scope) { ${code}; return {startNewTask,createProject,runConversationCommand,selectProject,selectWorkspace,changeProjectWorkspace}; }`)(scope);
  await callbacks.createProject();
  assert.equal(state.selection.projectId, project.id);
  assert.equal(state.selection.workspaceId, space.id);
  assert.equal(state.selection.executionRoot, project.workspace_path);
  const neighbor = { id: "neighbor-project", workspace_path: "/neighbor" };
  const neighborSpace = { id: "neighbor-shared", project_id: neighbor.id, root: neighbor.workspace_path, is_default: true };
  scope.projects = [project, neighbor]; scope.workspaces = [space, neighborSpace];
  scope.activeProjectId = project.id; scope.activeWorkspaceId = space.id;
  const first = scope.threadOpenRequestRef.current;
  await callbacks.selectProject(project.id);
  await callbacks.selectWorkspace(space);
  assert.equal(scope.threadOpenRequestRef.current, first + 2);
  const currentKey = helpers.taskDraftKey(helpers.newTaskSelection("/data", project, scope.workspaces));
  const neighborKey = helpers.taskDraftKey(helpers.newTaskSelection("/data", neighbor, scope.workspaces));
  drafts.set(currentKey, { text: "Unsent prompt from this empty task" });
  drafts.set(neighborKey, { text: "Another project's parked draft" });
  composerSessions.set(currentKey, { items: [{ id: "pending-file" }], request: null, error: "" });
  queues.set(currentKey, [{ draft: "Queued follow-up" }]);
  const pendingAttachment = { key: currentKey };
  attachmentOwners.set(currentKey, pendingAttachment);
  await callbacks.selectProject(neighbor.id);
  assert.equal(drafts.get(neighborKey).text, "Another project's parked draft");
  await callbacks.selectWorkspace(space);
  assert.equal(drafts.get(currentKey).text, "Unsent prompt from this empty task");
  scope.activeRunRef.current = { ownerKey: helpers.taskDraftKey(state.selection) };
  const original = state.selection;
  callbacks.startNewTask();
  assert.equal(state.selection, original, "a replacement empty task cannot take over a running conversation");
  assert.equal(drafts.get(currentKey).text, "Unsent prompt from this empty task");
  scope.activeRunRef.current = null;
  callbacks.startNewTask();
  assert.equal(drafts.has(currentKey), false, "an explicit new session clears the destination's empty draft");
  assert.deepEqual(composerSessions.get(currentKey), { items: [], request: null, error: "" });
  assert.deepEqual(queues.get(currentKey), []);
  assert.equal(pendingAttachment.key, null, "a late attachment cannot return to the cleared draft");
  assert.equal(drafts.get(neighborKey).text, "Another project's parked draft");
  scope.setProjectFolderError = () => {};
  scope.desktopBridge.chooseWorkspace = async () => "/new-path";
  scope.desktopBridge.setResearchProjectWorkspace = async () => ({ ...project, workspace_path: "/new-path" });
  await callbacks.changeProjectWorkspace(project);
  assert.equal(state.selection.executionRoot, "/new-path");
  scope.activeWorkspaceId = "sandbox";
  scope.executionWorkspace = "/execution/sandbox";
  await callbacks.runConversationCommand("side");
  assert.equal(created.workspaceId, "sandbox");
  assert.equal(created.workspacePath, "/execution/sandbox");
  assert.equal(state.side.workspace_id, "sandbox");
});
