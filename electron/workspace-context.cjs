// Research data and run identities use the accepted window owner. Settings,
// dialogs and filesystem-only operations do not need to open its database.
function isWorkspaceDataChannel(channel) {
  if (channel === "agent:claim-approvals" || channel === "agent:interrupt") return false;
  if (/:(?:get|save|reset)-settings$/.test(channel)) return false;
  if (/^(?:window|app|auth|model-config|agent-backend|web-search|environment|mcp|speech|sidebar|plugins|extensions|news|identity):/.test(channel)) return false;
  if (channel.startsWith("workspace:") && channel !== "workspace:open") return false;
  if (channel.startsWith("terminal:") && channel !== "terminal:run") return false;
  return true;
}

const fs = require("node:fs");
const path = require("node:path");

function canonicalWorkspace(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("A workspace folder is required.");
  const root = fs.realpathSync(path.resolve(value));
  if (!fs.statSync(root).isDirectory()) throw new Error("The workspace is not a folder.");
  return root;
}

/** A window selects the data store; project/session records select execution. */
function resolveResearchContext(store, input = {}) {
  const thread = input.threadId ? store.getResearchThread(input.threadId) : null;
  if (thread?.archived_at) throw new Error("Restore this conversation before continuing it.");
  if (thread && input.projectId && input.projectId !== thread.project_id) throw new Error("The conversation does not belong to the selected project.");
  const projectId = thread?.project_id || input.projectId;
  const project = projectId ? store.getResearchProject(projectId) : store.defaultResearchProject();
  if (!project || project.archived_at || !store.canAccessProject(project.id, "editor")) throw new Error("You do not have access to run a conversation in this project.");
  if (thread?.workspace_id && input.workspaceId && thread.workspace_id !== input.workspaceId) throw new Error("The conversation does not belong to the selected project workspace.");
  const workspaceId = thread?.workspace_id || input.workspaceId;
  const workspace = workspaceId ? store.getProjectWorkspace(workspaceId) : store.defaultProjectWorkspace(project.id);
  if (!workspace || workspace.project_id !== project.id) throw new Error("That workspace does not belong to this project.");
  const executionRoot = canonicalWorkspace(thread?.workspace_path || workspace.root || project.workspace_path || store.workspace);
  if (input.workspace && canonicalWorkspace(input.workspace) !== executionRoot) throw new Error("The execution folder does not match this conversation or project workspace.");
  return { dataRoot: store.workspace, projectId: project.id, workspaceId: workspace.id, workspace: executionRoot, thread };
}

/** Each invocation retains the sender's store even after the window switches. */
function createWorkspaceIpc({ ipcMain, store, workspaceForEvent }) {
  const displayedStores = new WeakMap();
  return {
    handle(channel, handler) {
      ipcMain.handle(channel, (event, ...args) => {
        const root = workspaceForEvent(event, channel, args);
        if (!root) return handler(event, ...args);
        const opening = channel === "workspace:open";
        const selected = store.createWorkspaceStore(root, { allowReplacement: opening });
        const displayed = displayedStores.get(event.sender);
        if (!opening && displayed && displayed !== selected) {
          throw new Error("The workspace database was replaced. Reopen the folder to load the new data.");
        }
        const captured = selected.captureStore();
        try {
          const result = selected.run(() => handler(event, ...args));
          // workspace:open is synchronous: only a successfully produced snapshot rebinds this window.
          if (opening) displayedStores.set(event.sender, selected);
          if (result && typeof result.then === "function") return Promise.resolve(result).finally(captured.release);
          captured.release();
          return result;
        } catch (error) { captured.release(); throw error; }
      });
    },
    on: (...args) => ipcMain.on(...args),
  };
}

module.exports = { canonicalWorkspace, createWorkspaceIpc, resolveResearchContext, isWorkspaceDataChannel };
