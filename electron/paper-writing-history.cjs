const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { createTwoFilesPatch } = require("diff");
const { captureManuscriptSources } = require("./manuscript-snapshot.cjs");
const { writableTarget } = require("./agent/workspace-tools.cjs");
const { workspacePath } = require("./workspace-files.cjs");

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const key = mainPath => hash(mainPath).slice(0, 24);
const location = (owner, id) => `.archimedes/manuscript-history/${key(owner.mainPath)}/${id}`;
const validId = id => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);

function storageTarget(root, relative, createParents = false) {
  const target = workspacePath(root, relative, { mustExist: false });
  const parts = path.relative(root, target).split(path.sep);
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error("Manuscript version paths cannot pass through symbolic links.");
    if (index < parts.length - 1 && !stat && createParents) fs.mkdirSync(current);
  }
  return { target };
}

function ownerFor(input) {
  const executionRoot = fs.realpathSync(input.executionRoot);
  if (!input.projectId || !input.workspaceId || typeof input.mainPath !== "string" || !/\.tex$/i.test(input.mainPath)
    || path.isAbsolute(input.mainPath) || input.mainPath.split(/[\\/]/).includes("..")) throw new Error("Choose a project manuscript main .tex file.");
  const mainPath = input.mainPath.replaceAll("\\", "/").replace(/^\.\//, "");
  writableTarget(executionRoot, mainPath);
  return { dataRoot: fs.realpathSync(input.dataRoot || executionRoot), projectId: input.projectId, workspaceId: input.workspaceId, executionRoot, mainPath, threadId: input.threadId || null };
}

function versionIndex(dataRoot) {
  const target = storageTarget(fs.realpathSync(dataRoot), ".archimedes/manuscript-history-index.json").target;
  return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : [];
}

function registerVersion(version) {
  const entries = versionIndex(version.dataRoot).filter(entry => entry.id !== version.id);
  entries.push({ id: version.id, dataRoot: version.dataRoot, projectId: version.projectId, workspaceId: version.workspaceId, executionRoot: version.executionRoot, mainPath: version.mainPath, threadId: version.threadId });
  const target = storageTarget(version.dataRoot, ".archimedes/manuscript-history-index.json", true).target;
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(entries, null, 2)}\n`); fs.renameSync(temporary, target);
}

/** The data workspace remembers historical roots even without a conversation. */
function listProjectManuscriptVersionOwners({ dataRoot, projectId }) {
  return versionIndex(dataRoot).filter(entry => entry.dataRoot === fs.realpathSync(dataRoot) && entry.projectId === projectId);
}

function isRegisteredManuscriptOwner(input) {
  const owner = ownerFor(input);
  return listProjectManuscriptVersionOwners(owner).some(entry => sameOwner(entry, owner) && Boolean(readVersion(owner, entry.id)));
}

function sameOwner(first, second) {
  return ["dataRoot", "projectId", "workspaceId", "executionRoot", "mainPath"].every(field => first[field] === second[field]);
}

function source(owner) {
  const snapshot = captureManuscriptSources(owner.executionRoot, owner.mainPath, { allowMissing: true });
  if (snapshot.untracked_inputs.length) throw new Error("Move linked manuscript inputs into this manuscript folder before saving or restoring a key version.");
  return snapshot;
}

function readVersion(input, id) {
  const owner = ownerFor(input);
  if (!validId(id)) throw new Error("Choose a saved manuscript key version.");
  const file = storageTarget(owner.executionRoot, `${location(owner, id)}/manifest.json`);
  const manifest = JSON.parse(fs.readFileSync(file.target, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.id !== id || !sameOwner(manifest, owner) || !Array.isArray(manifest.files)) throw new Error("This key version does not belong to the selected manuscript.");
  const prefix = path.posix.dirname(owner.mainPath);
  for (const entry of manifest.files) {
    if (typeof entry.path !== "string" || path.isAbsolute(entry.path) || entry.path.split("/").includes("..")
      || entry.path.split("/").includes(".archimedes") || prefix !== "." && !entry.path.startsWith(`${prefix}/`)
      || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error("Invalid manuscript version file inventory.");
  }
  return manifest;
}

function blob(owner, version, file) {
  const resolved = storageTarget(owner.executionRoot, `${location(owner, version.id)}/blobs/${file.sha256}`);
  const bytes = fs.readFileSync(resolved.target);
  if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error(`The saved version file has changed: ${file.path}`);
  return bytes;
}

function saveManuscriptVersion(input) {
  const owner = ownerFor(input), name = String(input.name || "").trim();
  if (!name || name.length > 120) throw new Error("Give this key version a name of at most 120 characters.");
  if (!input.restorationCheckpoint && !fs.statSync(writableTarget(owner.executionRoot, owner.mainPath).target, { throwIfNoEntry: false })?.isFile()) throw new Error("Open an existing manuscript before saving a key version.");
  const captured = source(owner);
  const id = randomUUID(), directory = storageTarget(owner.executionRoot, `${location(owner, id)}/blobs`, true).target;
  fs.mkdirSync(directory, { recursive: true });
  try {
    for (const file of captured.files) {
      const bytes = fs.readFileSync(storageTarget(owner.executionRoot, file.path).target);
      if (hash(bytes) !== file.sha256) throw new Error("The manuscript changed while saving this version. Save it again after editing.");
      const target = path.join(directory, file.sha256);
      if (!fs.existsSync(target)) fs.writeFileSync(target, bytes, { flag: "wx" });
    }
    const version = { schemaVersion: 1, ...owner, id, name, sourceVersion: captured.source_version, createdAt: new Date().toISOString(), files: captured.files, totalBytes: captured.total_bytes };
    fs.writeFileSync(path.join(directory, "../manifest.json"), `${JSON.stringify(version, null, 2)}\n`, { flag: "wx" });
    registerVersion(version);
    return version;
  } catch (error) { fs.rmSync(path.dirname(directory), { recursive: true, force: true }); throw error; }
}

/** List only durable, explicitly named versions; compiler receipts are separate. */
function listProjectManuscriptVersions(input) {
  const executionRoot = fs.realpathSync(input.executionRoot);
  const base = storageTarget(executionRoot, ".archimedes/manuscript-history").target;
  if (!fs.existsSync(base)) return [];
  const versions = [];
  for (const folder of fs.readdirSync(base, { withFileTypes: true })) {
    if (!folder.isDirectory() || !/^[a-f0-9]{24}$/.test(folder.name)) continue;
    for (const item of fs.readdirSync(path.join(base, folder.name), { withFileTypes: true })) {
      if (!item.isDirectory() || !validId(item.name)) continue;
      const file = path.join(base, folder.name, item.name, "manifest.json");
      if (!fs.existsSync(file)) continue;
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      if (manifest.projectId !== input.projectId || manifest.workspaceId !== input.workspaceId || manifest.executionRoot !== executionRoot
        || input.mainPath && manifest.mainPath !== input.mainPath) continue;
      versions.push(readVersion({ ...input, executionRoot, mainPath: manifest.mainPath }, manifest.id));
    }
  }
  return versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

function compareManuscriptVersion(input) {
  const owner = ownerFor(input), version = readVersion(owner, input.id), current = source(owner);
  const before = new Map(version.files.map(file => [file.path, file])), after = new Map(current.files.map(file => [file.path, file]));
  const changes = [];
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const oldFile = before.get(name), newFile = after.get(name);
    if (oldFile?.sha256 === newFile?.sha256) continue;
    const oldBytes = oldFile ? blob(owner, version, oldFile) : Buffer.alloc(0), newBytes = newFile ? fs.readFileSync(storageTarget(owner.executionRoot, name).target) : Buffer.alloc(0);
    const binary = /\.(pdf|png|jpe?g|webp|gif|eps|woff2?|ttf|otf)$/i.test(name) || oldBytes.includes(0) || newBytes.includes(0);
    changes.push({ path: name, status: !oldFile ? "added" : !newFile ? "removed" : "modified", binary,
      patch: binary ? "" : createTwoFilesPatch(`${version.name}/${name}`, `Current/${name}`, oldBytes.toString("utf8"), newBytes.toString("utf8"), "", "", { context: 3 }) });
  }
  return { version, currentSourceVersion: current.source_version, changes };
}

function restoreManuscriptVersion(input) {
  const owner = ownerFor(input), comparison = compareManuscriptVersion(input);
  if (comparison.currentSourceVersion !== input.expectedSourceVersion) throw new Error("The manuscript changed after this comparison. Compare it again before restoring.");
  const version = comparison.version;
  // Read every historical input before touching the manuscript. Retain the
  // actual current content as a named return point for this explicit restore.
  const contents = version.files.map(file => ({ file, bytes: blob(owner, version, file) }));
  const previousVersion = comparison.changes.length && source(owner).files.length ? saveManuscriptVersion({ ...owner, restorationCheckpoint: true, name: `Before restoring ${version.name}`.slice(0, 120) }) : null;
  const targets = contents.map(({ file, bytes }) => ({ file, bytes, target: storageTarget(owner.executionRoot, file.path, true).target }));
  const removedPaths = comparison.changes.filter(change => change.status === "added").map(change => change.path);
  for (const item of targets) fs.writeFileSync(item.target, item.bytes);
  for (const name of removedPaths) fs.unlinkSync(storageTarget(owner.executionRoot, name).target);
  return { version, previousVersion, restoredPaths: version.files.map(file => file.path), removedPaths };
}

module.exports = { listProjectManuscriptVersionOwners, isRegisteredManuscriptOwner, listProjectManuscriptVersions, saveManuscriptVersion, compareManuscriptVersion, restoreManuscriptVersion };
