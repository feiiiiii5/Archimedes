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
    || path.isAbsolute(input.mainPath) || input.mainPath.includes("\0")
    || input.mainPath.split(/[\\/]/).some(part => part.startsWith(".") && part !== ".")) throw new Error("Choose a project manuscript main .tex file.");
  const mainPath = input.mainPath.replaceAll("\\", "/").replace(/^\.\//, "");
  storageTarget(executionRoot, mainPath);
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

function readRegisteredVersion(entry) {
  try { return readVersion(entry, entry.id); }
  catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    return null;
  }
}

function isRegisteredManuscriptOwner(input) {
  const owner = ownerFor(input);
  return listProjectManuscriptVersionOwners(owner).some(entry => sameOwner(entry, owner) && Boolean(readRegisteredVersion(entry)));
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
    if (typeof entry.path !== "string" || !entry.path || entry.path === "." || entry.path.includes("\\")
      || path.isAbsolute(entry.path) || path.posix.normalize(entry.path) !== entry.path || entry.path.split("/").includes("..")
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
function listProjectManuscriptVersions(input, registeredOwners = []) {
  const executionRoot = fs.realpathSync(input.executionRoot);
  const dataRoot = fs.realpathSync(input.dataRoot || executionRoot);
  const base = storageTarget(executionRoot, ".archimedes/manuscript-history").target;
  const versions = new Map();
  const folders = fs.existsSync(base) ? fs.readdirSync(base, { withFileTypes: true }) : [];
  for (const folder of folders) {
    if (!folder.isDirectory() || !/^[a-f0-9]{24}$/.test(folder.name)) continue;
    for (const item of fs.readdirSync(path.join(base, folder.name), { withFileTypes: true })) {
      if (!item.isDirectory() || !validId(item.name)) continue;
      const file = path.join(base, folder.name, item.name, "manifest.json");
      if (!fs.existsSync(file)) continue;
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      if (manifest.dataRoot !== dataRoot || manifest.projectId !== input.projectId || manifest.workspaceId !== input.workspaceId
        || manifest.executionRoot !== executionRoot || input.mainPath && manifest.mainPath !== input.mainPath) continue;
      versions.set(manifest.id, readVersion({ ...input, executionRoot, mainPath: manifest.mainPath }, manifest.id));
    }
  }
  for (const entry of registeredOwners) {
    if (entry.dataRoot !== dataRoot || entry.projectId !== input.projectId || versions.has(entry.id)
      || input.mainPath && entry.mainPath !== input.mainPath) continue;
    const version = readRegisteredVersion(entry);
    if (version) versions.set(version.id, version);
  }
  return [...versions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

function compareManuscriptVersion(input) {
  const owner = ownerFor(input), version = readVersion(owner, input.id);
  return compareSources(owner, version, source(owner));
}

function compareSources(owner, version, current) {
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

function hasParent(root, target, candidates) {
  for (let parent = path.dirname(target); parent !== root; parent = path.dirname(parent)) {
    if (candidates.has(parent)) return true;
  }
  return false;
}

function verifyReplacingDirectory(directory, removed, exclusions, originalDirectory = directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const original = path.join(originalDirectory, entry.name);
    if (entry.isDirectory() && !exclusions.has(entry.name)) {
      verifyReplacingDirectory(path.join(directory, entry.name), removed, exclusions, original);
    } else if (!entry.isFile() || !removed.has(original)) {
      throw new Error(`A directory blocking restoration contains unsaved material: ${original}`);
    }
  }
}

function restorePlan(owner, version, current, comparison) {
  const root = owner.executionRoot;
  const changes = new Map(comparison.changes.map(change => [change.path, change.status]));
  const removedPaths = comparison.changes.filter(change => change.status === "added").map(change => change.path);
  const removed = new Set(removedPaths.map(name => storageTarget(root, name).target));
  const directories = new Set();
  const exclusions = new Set(current.excluded_directories);
  const writes = [];
  for (const file of version.files) {
    const bytes = blob(owner, version, file);
    if (!changes.has(file.path)) continue;
    const target = workspacePath(root, file.path, { mustExist: false });
    let existing;
    if (!hasParent(root, target, removed)) {
      storageTarget(root, file.path);
      existing = fs.lstatSync(target, { throwIfNoEntry: false });
      if (existing?.isDirectory()) {
        verifyReplacingDirectory(target, removed, exclusions);
        directories.add(target);
      } else if (existing && !existing.isFile()) {
        throw new Error(`The restored file is blocked by ${file.path}.`);
      }
    }
    writes.push({ target, bytes, relative: file.path, mode: existing?.isFile() ? existing.mode & 0o777 : undefined });
  }
  const moves = [
    ...directories,
    ...[...removed].filter(target => !hasParent(root, target, directories)),
    ...writes.filter(item => changes.get(item.relative) === "modified").map(item => item.target),
  ];
  return { moves, writes, removedPaths, directories, removed, exclusions };
}

function applyRestorePlan(root, { moves, writes, directories, removed, exclusions }) {
  const temporary = fs.mkdtempSync(storageTarget(root, ".archimedes/manuscript-history/.restore-", true).target);
  const originals = [], installed = [], created = [];
  function makeParents(target) {
    const parent = path.dirname(target);
    if (parent === root || fs.existsSync(parent)) return;
    makeParents(parent);
    fs.mkdirSync(parent);
    created.push(parent);
  }
  let keepOriginals = false;
  try {
    const prepared = writes.map((item, index) => {
      const file = path.join(temporary, `next-${index}`);
      fs.writeFileSync(file, item.bytes, { flag: "wx" });
      if (item.mode !== undefined) fs.chmodSync(file, item.mode);
      return { ...item, file };
    });
    for (const [index, target] of moves.entries()) {
      const backup = path.join(temporary, `original-${index}`);
      fs.renameSync(target, backup);
      originals.push({ target, backup });
      if (directories.has(target)) verifyReplacingDirectory(backup, removed, exclusions, target);
    }
    for (const { target, relative, file } of prepared) {
      storageTarget(root, relative);
      makeParents(target);
      fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
      installed.push(target);
    }
  } catch (error) {
    try {
      for (const target of installed.reverse()) fs.unlinkSync(target);
      for (const directory of created.reverse()) fs.rmdirSync(directory);
      for (const { target, backup } of originals.reverse()) {
        if (fs.lstatSync(target, { throwIfNoEntry: false })) throw new Error(`The original path is now occupied: ${target}`);
        fs.renameSync(backup, target);
      }
    } catch (rollbackError) {
      keepOriginals = true;
      throw new Error(`Could not finish restoring. Original files are available in ${temporary}. ${rollbackError.message}`, { cause: error });
    }
    throw error;
  } finally {
    if (!keepOriginals) {
      try { fs.rmSync(temporary, { recursive: true, force: true }); }
      catch (error) { console.warn(`Could not remove manuscript restore staging at ${temporary}:`, error.message); }
    }
  }
}

function restoreManuscriptVersion(input) {
  const owner = ownerFor(input), version = readVersion(owner, input.id), current = source(owner);
  const comparison = compareSources(owner, version, current);
  if (comparison.currentSourceVersion !== input.expectedSourceVersion) throw new Error("The manuscript changed after this comparison. Compare it again before restoring.");
  const plan = restorePlan(owner, version, current, comparison);
  const previousVersion = comparison.changes.length && current.files.length ? saveManuscriptVersion({ ...owner, restorationCheckpoint: true, name: `Before restoring ${version.name}`.slice(0, 120) }) : null;
  if (previousVersion && previousVersion.sourceVersion !== comparison.currentSourceVersion) throw new Error("The manuscript changed after this comparison. Compare it again before restoring.");
  if (plan.moves.length || plan.writes.length) applyRestorePlan(owner.executionRoot, plan);
  return { version, previousVersion, restoredPaths: version.files.map(file => file.path), removedPaths: plan.removedPaths };
}

module.exports = { listProjectManuscriptVersionOwners, isRegisteredManuscriptOwner, listProjectManuscriptVersions, saveManuscriptVersion, compareManuscriptVersion, restoreManuscriptVersion };
