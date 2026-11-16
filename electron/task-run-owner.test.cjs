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
