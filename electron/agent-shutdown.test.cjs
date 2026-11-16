const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const test = require("node:test");
const agent = require("./agent.cjs");
const store = require("./store.cjs");
const model = require("./model-config.cjs");

test("app shutdown interrupts active API work before stores close and rejects a later startup", async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "archimedes-agent-shutdown-")));
  const owner = store.createWorkspaceStore(root);
  model.initializeModelConfig(path.join(root, "settings"));
  model.saveModelConfig({ provider: "custom", baseUrl: "https://shutdown.invalid/v1", model: "fake", apiKey: "fake-not-a-credential" });
  const previous = global.fetch;
  t.after(() => { global.fetch = previous; store.closeAllWorkspaces(); fs.rmSync(root, { recursive: true, force: true }); });
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  global.fetch = async (_url, { signal }) => {
    entered();
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("Stopped"), { name: "AbortError" })), { once: true }));
  };
  const running = agent.runAgent({ dataStore: owner, workspace: root, prompt: "Controlled pending answer" });
  await waiting;
  const shutdown = await agent.shutdownAgents();
  assert.equal(shutdown.pending, 0);
  const result = await running;
  assert.equal(result.status, "interrupted");
  assert.equal(owner.getResearchThread(result.threadId).turns[0].status, "interrupted");
  assert.equal(owner.getSnapshot().tasks[0].status, "interrupted");
  await assert.rejects(agent.runAgent({ dataStore: owner, workspace: root, threadId: result.threadId, prompt: "After quit" }), /closing/);
  assert.deepEqual(await agent.shutdownAgents(), { pending: 0 });
});

test("the actual quit handler waits for agent shutdown before closing stores and prevents duplicate cleanup", async () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const start = source.indexOf('app.on("before-quit",');
  const gate = new Promise(resolve => { globalThis.__releaseAgentShutdown = resolve; });
  const calls = [];
  let handler, prevented = 0;
  const event = { preventDefault: () => { prevented++; } };
  const app = { on: (_name, callback) => { handler = callback; }, quit: () => { calls.push("quit"); handler(event); } };
  new Function("app", "store", "agent", "closeAllNativeClients", "closeAllTerminals", "collaborationServer", "presence",
    `let readyToQuit = false, quitting = false;\n${source.slice(start)}`)(app, { closeAllWorkspaces: () => calls.push("stores") }, { shutdownAgents: async () => { calls.push("agents"); await gate; } }, () => calls.push("native"), () => calls.push("terminals"), { close: () => calls.push("server") }, { closeAll: () => calls.push("presence") });
  handler(event); handler(event);
  await Promise.resolve();
  assert.deepEqual(calls, ["native", "terminals", "agents"]);
  assert.equal(prevented, 2);
  globalThis.__releaseAgentShutdown();
  await new Promise(setImmediate);
  assert.equal(calls.filter(call => call === "agents").length, 1);
  assert.equal(calls.filter(call => call === "quit").length, 1);
  assert.ok(calls.indexOf("stores") > calls.indexOf("agents"));
});
