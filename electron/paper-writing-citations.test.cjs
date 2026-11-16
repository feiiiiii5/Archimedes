const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { before, test } = require("node:test");
let citations;
before(async () => {
  const bibliography = await import("../src/bibliography.ts"), { transformWithOxc } = await import("vite");
  const source = fs.readFileSync(path.join(__dirname, "../src/paper-writing-citations.ts"), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/export function/g, "function");
  const { code } = await transformWithOxc(source, "paper-writing-citations.ts");
  citations = new Function(...Object.keys(bibliography), `${code.replace(/^export \{\};?$/gm, "")}\nreturn {prepareManuscriptCitation,manuscriptBibliographyPaths};`)(...Object.values(bibliography));
});

test("library metadata updates preserve a manuscript key, manual fields, other entries and directives", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archimedes-writing-bib-")), idle = fs.mkdtempSync(path.join(os.tmpdir(), "archimedes-writing-bib-idle-")), store = require("./store.cjs");
  store.openWorkspace(root);
  t.after(() => { store.openWorkspace(idle); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(idle, { recursive: true, force: true }); });
  const project = store.createResearchProject({ name: "Citations" }), library = store.listLibraries(project.id)[0];
  const raw = require("./test-support/bibliography-fixture.cjs").paper;
  const paper = store.addPaper(library.id, raw);
  store.setPaperBibliography(paper.id, { citekey: "library2026", entryType: "article" });
  const manual = `% Heading stays as written\n@string{venue = "My Venue"}\n@article{handKey,\n title={Old title},\n author={Original Author},\n year={2025},\n doi={${paper.doi}},\n journal=venue,\n note={A {hand-written} field with \\{escaped braces\\}},\n custom={keep-me}\n}\n\n@book{other, title={Another manual entry}, year={2024}}\n`;
  const first = citations.prepareManuscriptCitation(manual, store.listPapers(library.id)[0]);
  assert.equal(first.citekey, "handKey"); assert.match(first.content, /@article\{handKey,/);
  assert.ok(first.content.includes('@string{venue = "My Venue"}'));
  assert.ok(first.content.includes('note={A {hand-written} field with \\{escaped braces\\}}'));
  assert.ok(first.content.includes('custom={keep-me}'));
  assert.ok(first.content.includes('@book{other, title={Another manual entry}, year={2024}}'));
  assert.ok(first.content.includes(raw.title));
  store.repairLibraryPaperMetadata(paper.id, { title: "Corrected library metadata", year: 2027 });
  const second = citations.prepareManuscriptCitation(first.content, store.listPapers(library.id)[0]);
  assert.equal(second.citekey, "handKey"); assert.match(second.content, /Corrected library metadata/); assert.match(second.content, /year=\{2027\}/);
  assert.equal((second.content.match(/@article\{/g) || []).length, 1);
  const kept = citations.prepareManuscriptCitation(second.content, { ...store.listPapers(library.id)[0], title: "Not applied" }, false);
  assert.equal(kept.content, second.content); assert.equal(kept.citekey, "handKey");
  fs.writeFileSync(path.join(root, "references.bib"), second.content);
  assert.equal(fs.readFileSync(path.join(root, "references.bib"), "utf8"), second.content);
});

test("new references avoid collisions and keep their key when metadata changes", () => {
  const paper = { ...require("./test-support/bibliography-fixture.cjs").paper, id: "stable-paper-id", citekey: "taken", entry_type: "article" };
  const manual = "@article{taken, title={An unrelated paper}, doi={10.0000/unrelated}}\n";
  const first = citations.prepareManuscriptCitation(manual, paper);
  assert.equal(first.citekey, "taken_2"); assert.ok(first.content.startsWith(manual));
  const updated = citations.prepareManuscriptCitation(first.content, { ...paper, title: "Renamed title", doi: "10.5555/repaired" });
  assert.equal(updated.citekey, "taken_2"); assert.equal((updated.content.match(/@article\{/g) || []).length, 2);
  assert.deepEqual(citations.manuscriptBibliographyPaths("\\bibliography{refs,other}\n\\addbibresource[location=local]{nested/custom.bib}", "paper/main.tex"), ["paper/refs.bib", "paper/other.bib", "paper/nested/custom.bib"]);
});

test("updating a DOI-matched concatenated field consumes its whole expression and preserves unrelated bytes", () => {
  const paper = { ...require("./test-support/bibliography-fixture.cjs").paper, id: "concatenated-paper", citekey: "libraryKey", entry_type: "article" };
  const directive = '@string{suffix = " appendix"}\n';
  const note = ' note={Keep this {handwritten} note},\n';
  const other = '@book{manual, title={Unrelated reference}, year={2024}}\n';
  const original = `${directive}@article{handKey,\n title = {Original} # { suffix},\n doi={${paper.doi}},\n${note} custom=suffix\n}\n${other}`;
  const updated = citations.prepareManuscriptCitation(original, paper);
  assert.equal(updated.citekey, "handKey");
  assert.ok(updated.content.startsWith(directive));
  assert.ok(updated.content.includes(note));
  assert.ok(updated.content.endsWith(other));
  assert.ok(updated.content.includes(' custom=suffix\n'));
  assert.ok(!updated.content.includes('# { suffix}'));
  assert.match(updated.content, /title = \{Evidence handoff fixture\},/);
  const marked = citations.prepareManuscriptCitation(updated.content.replace('title = {Evidence handoff fixture}', 'title = "Old" # suffix'), { ...paper, doi: "10.5555/corrected", title: "Corrected title" });
  assert.equal(marked.citekey, "handKey");
  assert.match(marked.content, /title = \{Corrected title\},/);
  assert.ok(marked.content.includes(note));
  assert.ok(marked.content.endsWith(other));
  assert.ok(!marked.content.includes('"Old" # suffix'));
});
