const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { before, after, test } = require("node:test");
const { JSDOM } = require("jsdom");
let dom, React, createRoot, views;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const t = (key) => key;
before(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  React = require("react"); ({ createRoot } = require("react-dom/client"));
  const element = React.createElement, icons = require("lucide-react");
  const scope = { React, ...React, ...icons, useUISettings: () => ({ t, language: "en" }), useConfirm: () => async () => true,
    Dialog: ({ open, children }) => open ? element("section", null, children) : null,
    StateView: ({ title, description, action }) => element("section", null, title, description, action),
    SettingsChoiceGroup: () => null, SettingsRow: ({ children }) => element("div", null, children), SettingsSection: ({ children }) => element("section", null, children),
    cover: "cover.webp", motivation: "motivation.webp", architecture: "architecture.webp", collaboration: "collaboration.webp", results: "results.webp", examples: "examples.webp", training: "training.webp", evaluation: "evaluation.webp",
  };
  const { transformWithOxc } = await import("vite");
  async function load(file, names) {
    const source = fs.readFileSync(path.join(__dirname, "../src", file), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export default /gm, "").replace(/^export /gm, "");
    const { code } = await transformWithOxc(source, file, { jsx: { runtime: "classic" } });
    Object.assign(scope, new Function(...Object.keys(scope), `${code.replace(/^export \{\};?$/gm, "")}\nreturn {${names.join(",")}};`)(...Object.values(scope)));
  }
  await load("Tabs.tsx", ["Tabs", "Tab"]); await load("PaperToSlidesView.tsx", ["PaperToSlidesView"]); views = scope;
});
after(() => { dom.window.close(); for (const key of ["window", "document", "HTMLElement", "Node", "IS_REACT_ACT_ENVIRONMENT"]) delete global[key]; });
const origin = { dataRoot: "/data/a", projectId: "project-a", workspaceId: "workspace-a", threadId: "old-thread", workspace: "/old/source", mainPath: "paper/main.tex", selectedPath: "paper/section.tex", manifestPath: ".archimedes/latex-build/fixture/source-snapshot.json", sourceVersion: "a".repeat(64), pdfPath: ".archimedes/latex-build/fixture/main.pdf", pdfSha256: "b".repeat(64), buildId: "build-a" };
const model = { provider: "custom", model: "fixture", baseUrl: "http://localhost", hasApiKey: true, source: "saved" };
async function click(scope, text) {
  const button = [...scope.querySelectorAll("button")].find((node) => node.textContent.trim() === text);
  assert.ok(button, text); assert.equal(button.disabled, false, text);
  await React.act(async () => { button.click(); await tick(); });
}

test("actual slides view keeps source and target distinct, checks setup before starting, and isolates another data folder's input", async () => {
  const root = createRoot(document.getElementById("root")), started = [], checked = [];
  const bridge = { choosePaperReviewPdf: async () => "/other/chosen.pdf", getAgentBackendConfig: async () => ({ backend: "codex", binary: "codex", model: "" }), checkAgentBackend: async (profile) => { checked.push(profile.backend); return { ready: true, message: "Local fixture", models: [] }; }, checkPaperToSlidesSetup: async (input) => { checked.push(input); return { canStart: true, checks: [] }; } };
  const render = (data) => React.act(async () => { root.render(React.createElement(views.PaperToSlidesView, { bridge, workspace: "/new/target", dataRoot: data, projectId: "project-a", ownerKey: data, active: true, busy: false, manuscriptRequest: { origin, token: "request-a" }, onStart: async (input) => started.push(input) })); await tick(); });
  const shown = () => document.querySelector('.manuscript-owner-workspace:not([hidden])');
  try {
    await render("/data/a"); assert.ok(shown().textContent.includes(`${origin.workspace}/${origin.pdfPath}`));
    await click(shown(), "Create presentation"); assert.equal(started.length, 1); assert.deepEqual(started[0].manuscript, origin);
    assert.deepEqual(checked, ["codex", { backend: "codex", hasTaskToken: false }]);
    await render("/data/b"); assert.ok(!shown().textContent.includes(origin.pdfSha256.slice(0, 12))); assert.equal(shown().querySelector('.slides-primary').disabled, true);
    await render("/data/a"); assert.ok(shown().textContent.includes(origin.mainPath));
    await click(shown(), "Change");
    await click(shown(), "Create presentation"); assert.equal(started.at(-1).manuscript, undefined); assert.equal(started.at(-1).pdfPath, "/other/chosen.pdf");
  } finally { await React.act(async () => root.unmount()); }
});
