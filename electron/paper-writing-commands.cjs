const { canonicalWorkspace, resolveResearchContext } = require("./workspace-context.cjs");
const history = require("./paper-writing-history.cjs");

function registerPaperWritingCommands({ ipcMain, store }) {
  const selectedStore = () => store.currentStore ? store.currentStore() : store;
  function owner(input, selected = selectedStore()) {
    if (input.dataRoot && canonicalWorkspace(input.dataRoot) !== canonicalWorkspace(selected.workspace)) throw new Error("This manuscript belongs to another data workspace.");
    try {
      const context = resolveResearchContext(selected, { projectId: input.projectId, workspaceId: input.workspaceId, threadId: input.threadId || undefined, workspace: input.executionRoot });
      return { dataRoot: context.dataRoot, projectId: context.projectId, workspaceId: context.workspaceId, executionRoot: context.workspace, mainPath: input.mainPath, threadId: context.thread?.id || null };
    } catch (error) {
      const project = selected.getResearchProject(input.projectId), workspace = selected.getProjectWorkspace(input.workspaceId);
      const historical = { dataRoot: selected.workspace, projectId: input.projectId, workspaceId: input.workspaceId, executionRoot: input.executionRoot, mainPath: input.mainPath, threadId: input.threadId || null };
      if (!project || project.archived_at || workspace?.project_id !== project.id || !selected.canAccessProject(project.id, "editor") || !history.isRegisteredManuscriptOwner(historical)) throw error;
      const registered = history.listProjectManuscriptVersionOwners(historical).find(entry => entry.workspaceId === historical.workspaceId && entry.executionRoot === canonicalWorkspace(historical.executionRoot) && entry.mainPath === historical.mainPath);
      const thread = registered?.threadId ? selected.getResearchThread(registered.threadId) : null;
      historical.threadId = thread?.project_id === project.id && thread.workspace_id === workspace.id && canonicalWorkspace(thread.workspace_path) === canonicalWorkspace(historical.executionRoot) ? thread.id : null;
      return historical;
    }
  }
  ipcMain.handle("paper-writing:versions:list", (_event, input = {}) => {
    const selected = selectedStore();
    const context = owner(input, selected);
    const registered = history.listProjectManuscriptVersionOwners(context)
      .filter(entry => selected.getProjectWorkspace(entry.workspaceId)?.project_id === context.projectId);
    return history.listProjectManuscriptVersions(context, registered);
  });
  ipcMain.handle("paper-writing:versions:save", (_event, input = {}) => history.saveManuscriptVersion({ ...owner(input), name: input.name }));
  ipcMain.handle("paper-writing:versions:compare", (_event, input = {}) => history.compareManuscriptVersion({ ...owner(input), id: input.id }));
  ipcMain.handle("paper-writing:versions:restore", (_event, input = {}) => history.restoreManuscriptVersion({ ...owner(input), id: input.id, expectedSourceVersion: input.expectedSourceVersion }));
}

module.exports = { registerPaperWritingCommands };
