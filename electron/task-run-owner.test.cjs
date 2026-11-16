const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../src/App.tsx"), "utf8");

function extract(name) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, "m"));
  const end = source.slice(start + 1).search(/^  (?:async )?function /m);
  assert.ok(start >= 0 && end >= 0, name);
  return source.slice(start, start + 1 + end);
}

test("late run events and completion cannot adopt an empty task in another project", async () => {
  const helpers = await import("../src/task-selection.ts");
  const { transformWithOxc } = await import("vite");
  const selection = project => ({ dataRoot: "/data", projectId: project, workspaceId: `ws-${project}`, threadId: null, executionRoot: `/execution/${project}` });
  const resultThread = { id: "created-a", project_id: "a", workspace_id: "ws-a", workspace_path: "/execution/a", messages: [{ id: "a", text: "A response" }], events: [], turns: [], changeSets: [] };
  const bMessage = { id: "b", text: "B transcript" }, bAttachment = { id: "b-file" };
  const state = { messages: [], events: [], threads: [], pending: null, context: [], error: "" };
  let resolve, receive, submitted;
  const pending = new Promise(done => { resolve = done; });
  const update = key => value => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const scope = {
    ...helpers, crypto: global.crypto, t: value => value, workspaces: [],
    researchMode: "free-chat", reasoningEffort: "medium", contextLength: "standard", contextItems: [], activeThreadId: null,
    threadVisibility: "project", selectedHarness: "api", selectedNativeBackend: null, draftNoteKey: "draft:/data",
    taskSelectionRef: { current: selection("a") }, activeThreadIdRef: { current: null }, dataFolderLoadingRef: { current: false },
    activeRunRef: { current: null }, commandLockRef: { current: false }, noteValuesRef: { current: {} },
    threadsRef: { current: [resultThread] }, refreshingThreadsRef: { current: false },
    setSelectionError: update("error"), setMessages: update("messages"), setEvents: update("events"), setThreads: update("threads"), setPendingAction: update("pending"), setContextItems: update("context"),
    setResearchMode() {}, clearPendingAssistantDeltas() {}, setRunningOwnerKey() {}, setRunningThreadId() {}, setAgentBusy() {}, setInterrupting() {}, setNativeStream() {}, setNativeQuestions() {}, setBoundHarness() {}, setTrajectoryEvents() {}, setChangeSets() {}, setArtifactsVersion() {},
    applyTaskSelection(next) { scope.taskSelectionRef.current = next; },
    desktopBridge: { runAgent(input) { submitted = input; return pending; }, onAgentEvent(callback) { receive = callback; return () => {}; } },
  };
  const start = source.indexOf("    const unsubscribe = desktopBridge.onAgentEvent((event) => {");
  const end = source.indexOf("\n    return unsubscribe;", start);
  assert.ok(start > 0 && end > start);
  const { code } = await transformWithOxc(extract("submitPrompt") + "\n" + source.slice(start, end), "task-owner-callbacks.ts");
  const submitPrompt = new Function("scope", `with (scope) { ${code}; return submitPrompt; }`)(scope);
  const running = submitPrompt("A question");
  scope.taskSelectionRef.current = selection("b");
  state.messages = [bMessage]; state.context = [bAttachment]; state.events = [];
  receive({ type: "status", clientRunId: submitted.clientRunId, title: "A is starting" });
  assert.deepEqual(state.events, [], "two empty thread IDs do not identify the same task");
  receive({ type: "approval", clientRunId: submitted.clientRunId, threadId: "created-a", action: { id: "a-write" } });
  assert.equal(scope.taskSelectionRef.current.projectId, "b");
  assert.equal(scope.taskSelectionRef.current.threadId, null);
  assert.equal(state.pending, null);
  assert.deepEqual(state.events, []);
  resolve({ threadId: "created-a", thread: resultThread, actions: [] });
  assert.equal(await running, true);
  assert.deepEqual(scope.taskSelectionRef.current, selection("b"));
  assert.deepEqual(state.messages, [bMessage]);
  assert.deepEqual(state.context, [bAttachment]);
  assert.equal(state.threads[0], resultThread);
  assert.equal(submitted.workspace, "/execution/a");
});

test("a delayed approval uses its original task for command execution and completion", async () => {
  const helpers = await import("../src/task-selection.ts");
  const { transformWithOxc } = await import("vite");
  const a = { dataRoot: "/data", projectId: "a", workspaceId: "ws-a", threadId: "a", executionRoot: "/execution/a" };
  const b = { ...a, projectId: "b", workspaceId: "ws-b", threadId: "b", executionRoot: "/execution/b" };
  const state = { messages: [{ text: "B transcript" }], pending: { id: "b-pending" }, opened: 0, refreshed: 0, decremented: [] };
  let resolve, command, receive;
  const approved = new Promise(done => { resolve = done; });
  const scope = {
    ...helpers, crypto: global.crypto, t: value => value, taskOwnerKey: helpers.taskDraftKey(a), approvalThreadId: "a",
    taskSelectionRef: { current: a }, activeRunRef: { current: null }, runningCommandOwnerRef: { current: null },
    pendingAction: { id: "a-command", source: "agent", kind: "command", payload: { command: "echo approved" } }, runningSession: null,
    openWorkbench() { state.opened++; }, refreshWorkspaceFiles() { state.refreshed++; }, setSelectionError() {},
    setRunningSession(value) { scope.runningSession = value; }, setMessages(update) { state.messages = update(state.messages); },
    setPendingAction(update) { state.pending = update(state.pending); },
    setThreads(update) { const threads = update([{ id: "a", pending_actions: 1 }, { id: "b", pending_actions: 1 }]); state.decremented = threads; },
    desktopBridge: { approveAgentAction: () => approved, runTerminal: async input => { command = input; return { sessionId: "a-command-session" }; }, onTerminalData(callback) { receive = callback; return () => {}; } },
  };
  const start = source.indexOf("    const unsubscribe = desktopBridge.onTerminalData(");
  const end = source.indexOf("\n    return unsubscribe;", start);
  const { code } = await transformWithOxc(["clearThreadPendingAction", "approvePendingAction", "runCommand"].map(extract).join("\n") + "\n" + source.slice(start, end), "approval-owner-callbacks.ts");
  const approve = new Function("scope", `with (scope) { ${code}; return approvePendingAction; }`)(scope);
  const completing = approve();
  scope.taskSelectionRef.current = b;
  resolve(); await completing;
  assert.equal(command.cwd, "/execution/a");
  assert.equal(scope.runningCommandOwnerRef.current, helpers.taskDraftKey(a));
  assert.equal(state.opened, 0, "late approval does not open the current project's workbench");
  assert.equal(state.pending.id, "b-pending");
  assert.deepEqual(state.decremented.map(thread => thread.pending_actions), [0, 1]);
  receive({ sessionId: "a-command-session", data: "[process exited 0]" });
  assert.deepEqual(state.messages, [{ text: "B transcript" }]);
  scope.taskSelectionRef.current = a;
  scope.pendingAction = { id: "a-write", source: "agent", kind: "write", payload: { path: "result.txt" } };
  let resolveWrite;
  scope.desktopBridge.approveAgentAction = () => new Promise(done => { resolveWrite = done; });
  const writing = approve(); scope.taskSelectionRef.current = b; resolveWrite(); await writing;
  assert.equal(state.refreshed, 0, "late write approval does not refresh B with A's file tree");
});
