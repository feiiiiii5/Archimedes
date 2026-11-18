const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { before, after, test } = require("node:test");
const { JSDOM } = require("jsdom");
let dom, React, createRoot, views;
let locale = {};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const t = (key) => locale[key] || key;
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

test("setup renders missing and optional dependency diagnostics in Chinese", async () => {
  const { paperSlides } = await import("../src/i18n/translations/paperSlides.ts");
  const { paperReview } = await import("../src/i18n/translations/paperReview.ts");
  locale = { ...paperSlides, ...paperReview };
  const root = createRoot(document.getElementById("root"));
  const bridge = {
    getAgentBackendConfig: async () => ({ backend: "codex", binary: "codex", model: "" }),
    checkAgentBackend: async () => ({ ready: true, message: "Local fixture", models: [] }),
    checkPaperToSlidesSetup: async () => ({ canStart: false, checks: [
      { id: "python:requests", label: "Python requests", status: "missing", detail: "Add requests to the Python environment used by the slide skill." },
      { id: "fonts", label: "Fonts and visual output", status: "optional", detail: "Installed fonts, CJK rendering and visual output were not checked. CLI login is checked separately." },
    ] }),
  };
  try {
    await React.act(async () => root.render(React.createElement(views.PaperToSlidesView, { bridge, workspace: "/target", busy: false })));
    await click(document, "检查任务环境");
    assert.match(document.querySelector(".slides-setup").textContent, /请在幻灯片技能使用的 Python 环境中安装 requests/);
    assert.match(document.querySelector(".slides-setup details").textContent, /字体与视觉效果/);
    assert.match(document.querySelector(".slides-setup details").textContent, /命令行登录状态会单独检查/);
  } finally {
    await React.act(async () => root.unmount());
    locale = {};
  }
});

test("an unverified MinerU token permits start and a wrapped manuscript-stage rejection is localized", async () => {
  const { paperSlides } = await import("../src/i18n/translations/paperSlides.ts");
  const { paperReview } = await import("../src/i18n/translations/paperReview.ts");
  locale = { ...paperSlides, ...paperReview };
  const root = createRoot(document.getElementById("root"));
  let starts = 0;
  const bridge = {
    getAgentBackendConfig: async () => ({ backend: "codex", binary: "codex", model: "" }),
    checkAgentBackend: async () => ({ ready: true, message: "Local fixture", models: [] }),
    checkPaperToSlidesSetup: async () => ({ canStart: true, checks: [
      { id: "mineru-token", label: "MinerU token", status: "optional", detail: "The slide skill checks for a MinerU token at startup, including credentials configured in its .env file." },
    ] }),
  };
  try {
    await React.act(async () => root.render(React.createElement(views.PaperToSlidesView, {
      bridge, workspace: "/target", dataRoot: origin.dataRoot, projectId: origin.projectId, busy: false,
      manuscriptRequest: { origin, token: "ready" }, onStart: async () => {
        starts++;
        throw new Error("Error invoking remote method 'paper-to-slides:stage': Error: Save and compile the current manuscript before handing it off.");
      },
    })));
    await click(document, "检查任务环境");
    assert.match(document.querySelector(".slides-setup").textContent, /启动时检查 MinerU Token/);
    await click(document, "生成演示文稿");
    assert.equal(starts, 1);
    assert.equal(document.querySelector(".slides-error").textContent, "请保存并编译当前稿件，然后再交接。");
  } finally {
    await React.act(async () => root.unmount());
    locale = {};
  }
});
