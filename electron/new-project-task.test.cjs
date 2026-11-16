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
  let created;
  const scope = {
    ...helpers, t: value => value, projects: [{ id: "old-project", workspace_path: "/old" }], workspaces: [], workspace: "/data",
    newProjectName: "New project", newProjectWorkspace: project.workspace_path, agentBusy: false,
    taskSelectionRef: { current: null }, dataFolderLoadingRef: { current: false }, threadOpenRequestRef: { current: 0 }, activeThreadIdRef: { current: null }, commandLockRef: { current: false },
    activeProjectId: "old-project", activeWorkspaceId: null, sideThread: null, researchMode: "free-chat", threadVisibility: "project", executionWorkspace: "/old", initialMessages: [],
    setProjects() {}, setWorkspaces() {}, setNewProjectName() {}, setNewProjectError() {}, setNewProjectOpen() {},
    setMainSection() {}, clearPendingAssistantDeltas() {}, setBoundHarness() {}, setThreadVisibility() {}, setMessages() {}, setTrajectoryEvents() {}, setEvents() {}, setPendingAction() {}, setContextItems() {}, setChangeSets() {}, setChatViewNonce() {}, setWorkbenchOpen() {},
    applyTaskSelection(value) { state.selection = value; scope.taskSelectionRef.current = value; },
    setThreads(update) { state.threads = update(state.threads); }, setSideThread(value) { state.side = value; },
    desktopBridge: { createResearchProject: async () => project, listResearchWorkspaces: async () => [space], createResearchThread: async input => { created = input; return { id: "side", project_id: input.projectId, workspace_id: input.workspaceId, workspace_path: input.workspacePath }; } },
  };
  const { code } = await transformWithOxc(["startNewTask", "createProject", "runConversationCommand"].map(extract).join("\n"), "new-project-task.ts");
  const callbacks = new Function("scope", `with(scope) { ${code}; return {createProject,runConversationCommand}; }`)(scope);
  await callbacks.createProject();
  assert.equal(state.selection.projectId, project.id);
  assert.equal(state.selection.workspaceId, space.id);
  assert.equal(state.selection.executionRoot, project.workspace_path);
  scope.activeProjectId = project.id; scope.activeWorkspaceId = "sandbox";
  scope.executionWorkspace = "/execution/sandbox";
  await callbacks.runConversationCommand("side");
  assert.equal(created.workspaceId, "sandbox");
  assert.equal(created.workspacePath, "/execution/sandbox");
  assert.equal(state.side.workspace_id, "sandbox");
});
