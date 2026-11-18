const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { checkPaperToSlidesSetup } = require("./paper-to-slides-setup.cjs");

const python = execFileSync(process.platform === "win32" ? "python" : "python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim();
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "archimedes-slides-setup-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("the actual existing prerequisite script reports local presence without exposing token values or treating optional QA as a generation blocker", async () => {
  const result = await checkPaperToSlidesSetup({ backend: "codex", hasTaskToken: false }, { python,
    env: { ...process.env, MINERU_API_TOKEN: "fake-setup-token-never-return-this" } });
  assert.equal(result.checks.find(check => check.id === "python").status, "ready");
  assert.equal(result.checks.find(check => check.id === "command:node").status, "ready");
  assert.equal(result.checks.find(check => check.id === "mineru-token").status, "ready");
  assert.ok(!JSON.stringify(result).includes("fake-setup-token-never-return-this"));
  assert.ok(result.checks.some(check => check.id === "node:pptxgenjs"));
  assert.ok(result.checks.some(check => check.id === "python:requests"));
  assert.ok(result.checks.some(check => check.id === "python:markitdown"));
  assert.equal(result.checks.find(check => check.id === "fonts").status, "optional");
  assert.equal(typeof result.canStart, "boolean");
});

test("setup probes the documented Conda environment even when Electron uses a different Python", async () => {
  const calls = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args });
    assert.match(options.stdin, /global_node_modules/);
    return { exitCode: 0, stdout: JSON.stringify({
      commands: { node: true, npm: true },
      python_packages: { requests: true, dotenv: true, PIL: true },
      global_node_modules: { pptxgenjs: true },
    }) };
  };
  const input = { backend: "codex", hasTaskToken: true };
  assert.equal((await checkPaperToSlidesSetup(input, { env: { CONDA_EXE: "configured-conda", CONDA_DEFAULT_ENV: "base" }, execute })).canStart, true);
  assert.equal((await checkPaperToSlidesSetup(input, { env: { CONDA_DEFAULT_ENV: "paper2anything" }, execute })).canStart, true);
  assert.deepEqual(calls, [
    { command: "configured-conda", args: ["run", "-n", "paper2anything", "--no-capture-output", "python", "-B", "-"] },
    { command: "python", args: ["-B", "-"] },
  ]);
});

test("the inventory resolves a Windows npm command shim in a path with spaces", async t => {
  const root = fixture(t), bin = path.join(root, "Node tools"), globalModules = path.join(root, "global modules");
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(globalModules, "pptxgenjs"), { recursive: true });
  const npm = path.join(bin, "npm");
  fs.writeFileSync(npm, "#!/bin/sh\n");
  fs.writeFileSync(npm + ".cmd", '@echo off\r\nif not "%*"=="root -g" exit /b 2\r\necho %ARCHIMEDES_SLIDES_TEST_NPM_ROOT%\r\n');
  if (process.platform === "win32") {
    const result = await checkPaperToSlidesSetup({ backend: "codex", hasTaskToken: true }, { python,
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, ARCHIMEDES_SLIDES_TEST_NPM_ROOT: globalModules } });
    assert.equal(result.checks.find(check => check.id === "node:pptxgenjs").status, "ready");
    return;
  }
  // The normal macOS/Linux run checks the command passed to Windows. The
  // Windows branch above runs the real shim when the suite has a Windows host.
  const probe = path.join(__dirname, "assets/research-skills/paper2slides/codex/scripts/check_env.py");
  const worker = `
import importlib.util
import os
import runpy
import shutil
import subprocess
import sys
from types import SimpleNamespace

script, npm, root = sys.argv[1:]
sys.platform = "win32"
shutil.which = lambda name: {"node": "node.exe", "npm": npm, npm + ".cmd": npm + ".cmd"}.get(name)
importlib.util.find_spec = lambda name: None
def run(command, **options):
    assert command == '"' + npm + '.cmd" root -g'
    assert options["shell"]
    return SimpleNamespace(stdout=root, returncode=0)
subprocess.run = run
runpy.run_path(script, run_name="__main__")
`;
  const report = JSON.parse(execFileSync(python, ["-B", "-c", worker, probe, npm, globalModules], { encoding: "utf8" }));
  assert.equal(report.commands.npm, npm + ".cmd");
  assert.equal(report.global_node_modules.pptxgenjs, true);
});

test("missing Python and missing PATH tools produce explicit actionable checks rather than a ready result", async t => {
  const root = fixture(t);
  const noPython = await checkPaperToSlidesSetup({ backend: "claude", hasTaskToken: true }, { python: path.join(root, "absent-python"), env: { PATH: root } });
  assert.equal(noPython.canStart, false); assert.match(noPython.checks[0].detail, /could not check the paper2anything Conda environment/);
  const noTools = await checkPaperToSlidesSetup({ backend: "claude", hasTaskToken: true }, { python, env: { PATH: root, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(noTools.checks.find(check => check.id === "command:node").status, "missing");
  assert.equal(noTools.checks.find(check => check.id === "command:npm").status, "missing");
  assert.equal(noTools.checks.find(check => check.id === "command:soffice").status, "optional");
  assert.equal(noTools.checks.find(check => check.id === "mineru-token").status, "ready");
  assert.equal(noTools.canStart, false);
  await assert.rejects(checkPaperToSlidesSetup({ backend: "api" }), /Codex or Claude/);
});

test("the real presence script can permit a limited generation environment while preview and QA tools remain optional", { skip: process.platform === "win32" ? "POSIX-only isolated interpreter inventory fixture" : false }, async t => {
  const root = fixture(t), bin = path.join(root, "bin"), modules = path.join(root, "python-modules"), globalModules = path.join(root, "global-node-modules");
  for (const folder of [bin, modules, globalModules]) fs.mkdirSync(folder);
  // This is an inventory fixture, not a claim these empty modules execute.
  // The production script deliberately checks presence only.
  for (const name of ["requests", "dotenv", "PIL"]) fs.writeFileSync(path.join(modules, `${name}.py`), "");
  fs.mkdirSync(path.join(globalModules, "pptxgenjs"));
  fs.symlinkSync(process.execPath, path.join(bin, "node"));
  fs.writeFileSync(path.join(bin, "npm"), `#!/bin/sh\nprintf '%s\\n' '${globalModules}'\n`, { mode: 0o755 });
  const isolatedPython = path.join(bin, "python3");
  fs.writeFileSync(isolatedPython, `#!/bin/sh\nexec '${python.replaceAll("'", "'\\''")}' -S "$@"\n`, { mode: 0o755 });
  const options = { python: isolatedPython, env: { PATH: bin, PYTHONPATH: modules } };
  const limited = await checkPaperToSlidesSetup({ backend: "claude", hasTaskToken: true }, options);
  assert.equal(limited.checks.find(check => check.id === "command:soffice").status, "optional");
  assert.equal(limited.checks.find(check => check.id === "python:markitdown").status, "optional");
  assert.equal(limited.checks.find(check => check.id === "node:react-icons").status, "optional");
  assert.equal(limited.canStart, true);
  const noToken = await checkPaperToSlidesSetup({ backend: "claude", hasTaskToken: false }, options);
  assert.equal(noToken.canStart, false); assert.equal(noToken.checks.find(check => check.id === "mineru-token").status, "missing");
});

test("a stalled npm root subprocess is bounded and killed with the real Python probe process group", { skip: process.platform === "win32" ? "POSIX descendant fixture; Windows uses the existing taskkill runner path" : false }, async t => {
  const root = fixture(t), orphan = path.join(root, "orphan"), started = path.join(root, "npm-started");
  fs.symlinkSync(process.execPath, path.join(root, "node"));
  fs.writeFileSync(path.join(root, "npm"), `#!/bin/sh\necho started > '${started}'\n/bin/sleep 2\n/usr/bin/touch '${orphan}'\n`, { mode: 0o755 });
  const before = Date.now();
  const result = await checkPaperToSlidesSetup({ backend: "codex", hasTaskToken: true }, { python, env: { PATH: root }, timeoutMs: 1_000 });
  assert.equal(result.canStart, false); assert.match(result.checks[0].detail, /timed out/);
  assert.ok(Date.now() - before < 2_000);
  assert.equal(fs.existsSync(started), true, "the real script must actually reach npm before timing out");
  await new Promise(resolve => setTimeout(resolve, 2_200));
  assert.equal(fs.existsSync(orphan), false, "the npm descendant must not continue after the check returns");
});
