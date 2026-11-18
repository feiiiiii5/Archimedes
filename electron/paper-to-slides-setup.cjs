const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const SCRIPT = path.join(__dirname, "assets/research-skills/paper2slides/codex/scripts/check_env.py");
const REQUIRED_PYTHON = new Set(["requests", "dotenv", "PIL"]);

// The existing inventory script invokes npm. Stop that descendant too when a
// check times out, so preparing the form cannot leave a stalled probe running.
function runProbe(command, args, { env, stdin, timeoutMs } = {}) {
  return new Promise(resolve => {
    let stdout = "", stderr = "", error = "", timedOut = false, timer, forceTimer;
    const child = spawn(command, args, { env, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    const stop = signal => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => child.kill()); killer.unref();
      } else {
        try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
      }
    };
    child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-32_000); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-32_000); });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
    child.once("error", cause => { error = cause.message; });
    timer = setTimeout(() => {
      timedOut = true; stop("SIGTERM");
      forceTimer = setTimeout(() => stop("SIGKILL"), 500); forceTimer.unref();
    }, timeoutMs); timer.unref();
    child.once("close", exitCode => {
      clearTimeout(timer);
      if (!timedOut) clearTimeout(forceTimer);
      resolve({ exitCode, stdout, stderr, timedOut, error });
    });
  });
}

async function checkPaperToSlidesSetup(input = {}, { python, env = process.env, timeoutMs = 15_000, execute = runProbe, scriptPath = SCRIPT } = {}) {
  if (!["codex", "claude"].includes(input.backend)) throw new Error("Paper to Slides requires Codex or Claude Code.");
  const script = fs.readFileSync(scriptPath, "utf8");
  // Node/Electron can read ASAR resources; the external Python process cannot.
  // stdin also avoids importing the skill package's dotenv initialization.
  const direct = python || env.CONDA_DEFAULT_ENV === "paper2anything";
  const command = direct ? (python || "python") : (env.CONDA_EXE || (process.platform === "win32" ? "conda.exe" : "conda"));
  const args = direct ? ["-B", "-"] : ["run", "-n", "paper2anything", "--no-capture-output", "python", "-B", "-"];
  const result = await execute(command, args, { stdin: script, env: { ...env, NPM_CONFIG_UPDATE_NOTIFIER: "false", NPM_CONFIG_LOGS_MAX: "0" },
    timeoutMs, separateOutput: true, captureChars: 32_000 });
  if (result.exitCode !== 0 || result.timedOut || result.aborted || result.error) {
    return { checks: [{ id: "dependency-probe", label: "Slide dependencies", status: "missing",
      detail: result.timedOut ? "The dependency check timed out and its process group was stopped. No setup was changed."
        : "Python could not check the paper2anything Conda environment. Make Conda and the paper2anything environment available to Archimedes." }], canStart: false };
  }
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { return { checks: [{ id: "dependency-probe", label: "Slide dependencies", status: "missing", detail: "The dependency check returned an unreadable report. Dependencies were not verified." }], canStart: false }; }
  const checks = [{ id: "python", label: "Python 3", status: "ready", detail: "The slide prerequisite script ran in the paper2anything Python environment." }];
  const add = (id, label, exists, required, detail) => checks.push({ id, label, status: exists ? "ready" : required ? "missing" : "optional", detail: exists ? "Found in the slide environment." : detail });
  for (const name of ["node", "npm", "pdftoppm", "soffice"]) add(`command:${name}`, name, Boolean(report.commands?.[name]), ["node", "npm"].includes(name),
    ["node", "npm"].includes(name) ? `Make ${name} available in the slide environment.` : `${name} is unavailable. PDF preview or visual QA may be limited.`);
  for (const name of ["requests", "dotenv", "PIL", "markitdown"]) add(`python:${name}`, `Python ${name}`, report.python_packages?.[name] === true, REQUIRED_PYTHON.has(name),
    REQUIRED_PYTHON.has(name) ? `Add ${name} to the Python environment used by the slide skill.` : "Content QA is unavailable in this Python environment. Its results must not be claimed as checked.");
  for (const name of ["pptxgenjs", "react", "react-dom", "react-icons", "sharp"]) add(`node:${name}`, name, report.global_node_modules?.[name] === true, name === "pptxgenjs",
    name === "pptxgenjs" ? "Make pptxgenjs available in the global npm directory used by the existing slide renderer."
      : `${name} is unavailable. Icon or image rendering may be limited.`);
  const token = input.hasTaskToken === true || report.mineru_token_configured === true;
  checks.push({ id: "mineru-token", label: "MinerU token", status: token ? "ready" : "optional",
    detail: token ? "Configured for this task or environment; authentication and network access were not checked."
      : "The slide skill checks for a MinerU token at startup, including credentials configured in its .env file." });
  checks.push({ id: "fonts", label: "Fonts and visual output", status: "optional", detail: "Installed fonts, CJK rendering and visual output were not checked. CLI login is checked separately." });
  return { checks, canStart: checks.every(check => check.status !== "missing") };
}

module.exports = { checkPaperToSlidesSetup };
