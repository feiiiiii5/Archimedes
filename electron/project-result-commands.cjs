const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const canonicalWorkspace = (root) => fs.realpathSync(root);
const packages = require("./project-results.cjs");

// The window owns the data store; persisted project/session records own paths.
// No renderer-provided execution root or file path is accepted here.
function registerProjectResultCommands({ ipcMain, store, files = packages }) {
  const required = (id, owner = store) => {
    const record = owner.getProjectResultRecord(id);
    if (!record) throw new Error("Project result not found in this data workspace.");
    return record;
  };
  ipcMain.handle("project-results:list", (_event, input = {}) => store.listProjectResultRecords(input));
  ipcMain.handle("project-results:get", (_event, { id } = {}) => files.readPackage(required(id)));
  ipcMain.handle("project-results:read-file", (_event, { id, name } = {}) => files.readPackageFile(required(id), name));
  ipcMain.handle("project-results:link-thread", (_event, { id, threadId, workspace } = {}) => {
    const owner = workspace ? store.createWorkspaceStore(workspace) : store;
    const record = required(id, owner);
    if (!owner.canAccessProject(record.projectId, "editor")) throw new Error("You do not have permission to save a project result.");
    if (!threadId) throw new Error("A saved discussion is required.");
    const detail = files.readPackage(record);
    if (detail.fileState !== "ready") throw new Error("The saved result files changed or are missing.");
    owner.registerProjectResult({ ...detail, threadId });
    return { ...detail, threadId };
  });
  ipcMain.handle("project-results:save", (_event, input = {}) => {
    const existing = input.id ? required(input.id) : null;
    if (existing && (input.projectId !== existing.projectId || input.kind !== existing.kind
      || (input.workspaceId && input.workspaceId !== existing.workspaceId))) throw new Error("A saved result cannot move to another project or workspace.");
    const project = store.getResearchProject(input.projectId);
    if (!project || project.archived_at || !store.canAccessProject(project.id, "editor")) throw new Error("You do not have permission to save a project result.");
    const context = existing || (() => {
      const workspace = input.workspaceId ? store.getProjectWorkspace(input.workspaceId) : store.defaultProjectWorkspace(project.id);
      if (!workspace || workspace.project_id !== project.id || workspace.archived_at || !workspace.root) throw new Error("Select an available workspace in this project.");
      return { projectId: project.id, workspaceId: workspace.id, executionRoot: canonicalWorkspace(workspace.root) };
    })();
    const threadId = input.threadId === undefined ? existing?.threadId || null : input.threadId;
    if (threadId) {
      const thread = store.getResearchThread(threadId);
      if (thread.project_id !== context.projectId || thread.workspace_id !== context.workspaceId
        || canonicalWorkspace(thread.workspace_path) !== context.executionRoot) throw new Error("The linked session does not belong to this project result.");
    }
    const receipt = files.savePackage({
      id: existing?.id || randomUUID(), projectId: context.projectId, workspaceId: context.workspaceId,
      executionRoot: context.executionRoot, threadId, kind: input.kind, title: input.title,
      manifest: input.manifest, files: input.files,
    });
    // The manifest is the durable file receipt. Report DB failure honestly;
    // filesystem writes and SQLite cannot be one transaction.
    store.registerProjectResult(receipt);
    return receipt;
  });
}

module.exports = { registerProjectResultCommands };
