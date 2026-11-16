const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const NOTES_FILE = "workbench-notes.json";
const MAX_KEY_LENGTH = 240;
const MAX_CONTENT_LENGTH = 1_000_000;

let notesPath = "";
let notes = {};

function normalizeKey(key) {
  const value = String(key ?? "").trim();
  if (!value) throw new Error("A note key is required.");
  // A complete owner includes both folder paths. Hash it instead of truncating
  // away the session/project identity at the end of a long path.
  return value.startsWith("owner:") ? `owner:${createHash("sha256").update(value).digest("hex")}` : value.slice(0, MAX_KEY_LENGTH);
}

function initialize(userDataPath) {
  notesPath = path.join(userDataPath, NOTES_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(notesPath, "utf8"));
    notes = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    notes = {};
  }
  return {};
}

function persist() {
  if (!notesPath) return;
  fs.mkdirSync(path.dirname(notesPath), { recursive: true });
  fs.writeFileSync(notesPath, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
}

function getNote(key) {
  const normalizedKey = normalizeKey(key);
  let entry = notes[normalizedKey];
  const owner = String(key).match(/^owner:(thread|new):(\[.*\])$/);
  if (!entry && owner) {
    const parts = JSON.parse(owner[2]);
    const legacyKey = normalizeKey(owner[1] === "thread" ? parts[1] : `draft:${parts[0]}`);
    if (notes[legacyKey]) {
      entry = notes[normalizedKey] = notes[legacyKey];
      delete notes[legacyKey];
      persist();
    }
  }
  return {
    content: typeof entry?.content === "string" ? entry.content : "",
    updatedAt: typeof entry?.updatedAt === "string" ? entry.updatedAt : null,
  };
}

function saveNote(key, content) {
  const normalizedKey = normalizeKey(key);
  const text = String(content ?? "").slice(0, MAX_CONTENT_LENGTH);
  if (!text.trim()) {
    delete notes[normalizedKey];
    persist();
    return { content: "", updatedAt: null };
  }
  const updatedAt = new Date().toISOString();
  notes[normalizedKey] = { content: text, updatedAt };
  persist();
  return { content: text, updatedAt };
}

function deleteNote(key) {
  const normalizedKey = normalizeKey(key);
  const deleted = Boolean(notes[normalizedKey]);
  if (deleted) {
    delete notes[normalizedKey];
    persist();
  }
  return { deleted };
}

module.exports = {
  initialize,
  getNote,
  saveNote,
  deleteNote,
};
