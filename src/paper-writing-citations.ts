import { citationKeyIdentity, exportBibliography, matchBibliographyPaper, parseBibliography, type BibliographyPaper } from "./bibliography";

type BibField = { name: string; valueStart: number; valueEnd: number; concatenated: boolean };
type BibBlock = { start: number; end: number; key: string; fields: BibField[]; close: string; fieldsEnd: number };

/** Locate literal entry spans without rewriting comments, directives or macros. */
function bibliographyBlocks(text: string): BibBlock[] {
  const blocks: BibBlock[] = [];
  let cursor = 0;
  const skip = () => { while (cursor < text.length) { if (/\s|,/.test(text[cursor])) cursor++; else if (text[cursor] === "%") { while (cursor < text.length && text[cursor] !== "\n") cursor++; } else break; } };
  // Directive bodies are opaque: a commented-out entry must not become an
  // editing target or reserve a citation key.
  const skipDirective = (open: string, close: string) => {
    cursor++;
    let depth = 1, braces = 0, quoted = false;
    while (cursor < text.length) {
      const character = text[cursor];
      if (character === "\\") { cursor += 2; continue; }
      if (open === "{") {
        if (character === "{") depth++;
        else if (character === "}" && --depth === 0) { cursor++; return; }
      } else {
        if (character === "{") braces++;
        else if (character === "}" && braces > 0) braces--;
        else if (character === '"' && braces === 0) quoted = !quoted;
        else if (!quoted && character === "(" && braces === 0) depth++;
        else if (!quoted && character === ")" && braces === 0 && --depth === 0) { cursor++; return; }
      }
      cursor++;
    }
  };
  while (cursor < text.length) {
    if (text[cursor] === "%") { while (cursor < text.length && text[cursor] !== "\n") cursor++; continue; }
    if (text[cursor] !== "@") { cursor++; continue; }
    const start = cursor, directive = /^@([a-z]+)\s*([{(])/i.exec(text.slice(cursor));
    if (!directive) { cursor++; continue; }
    const open = directive[2], close = open === "{" ? "}" : ")";
    cursor += directive[0].length - 1;
    if (["comment", "preamble", "string"].includes(directive[1].toLowerCase())) { skipDirective(open, close); continue; }
    const header = /^@([a-z]+)\s*[{(]\s*([^,\s{}()]+)\s*,/i.exec(text.slice(start));
    if (!header) { cursor = start + 1; continue; }
    cursor = start + header[0].length;
    const fields: BibField[] = [];
    while (cursor < text.length) {
      skip();
      if (text[cursor] === close) {
        const fieldsEnd = cursor++;
        blocks.push({ start, end: cursor, key: header[2], fields, close, fieldsEnd });
        break;
      }
      const field = /^([a-z][\w-]*)\s*=\s*/i.exec(text.slice(cursor));
      if (!field) { while (cursor < text.length && text[cursor] !== close) cursor++; continue; }
      cursor += field[0].length;
      const valueStart = cursor;
      let braces = 0, quote = false, concatenated = false, valueEnd = cursor;
      while (cursor < text.length) {
        const character = text[cursor];
        if (character === "\\") { cursor += 2; valueEnd = cursor; continue; }
        if (!quote && braces === 0) {
          if (character === "," || character === close) break;
          if (character === "#") concatenated = true;
          if (character === "%") { while (cursor < text.length && text[cursor] !== "\n") cursor++; continue; }
        }
        if (character === "{") braces++;
        else if (character === "}" && braces > 0) braces--;
        else if (character === '"' && braces === 0) quote = !quote;
        cursor++;
        if (!/\s/.test(character)) valueEnd = cursor;
      }
      fields.push({ name: field[1].toLowerCase(), valueStart, valueEnd, concatenated });
    }
  }
  return blocks;
}

export function citationKeyFor(paper: BibliographyPaper) {
  return paper.citekey || `paper_${paper.id.replace(/[^a-z0-9]/gi, "")}`;
}

function hasTrailingFieldSeparator(content: string, block: BibBlock) {
  const lastField = block.fields[block.fields.length - 1];
  if (!lastField) return true; // The parsed entry header already contains the key separator.
  const tail = content.slice(lastField.valueEnd, block.fieldsEnd).replace(/%[^\n]*/g, "").trimStart();
  return tail.startsWith(",");
}

export function prepareManuscriptCitation(content: string, paper: BibliographyPaper, update = true) {
  const blocks = bibliographyBlocks(content), marker = `% Archimedes paper: ${encodeURIComponent(paper.id)}`;
  const markerAt = content.indexOf(marker);
  let existing = markerAt < 0 ? undefined : blocks.find(block => block.start > markerAt && !content.slice(markerAt + marker.length, block.start).trim());
  if (!existing) {
    const parsed = blocks.flatMap((block) => {
      const fields = block.fields.filter(field => !field.concatenated && ["title", "author", "year", "doi", "eprint", "archiveprefix", "url"].includes(field.name))
        .map(field => ({ name: field.name, value: content.slice(field.valueStart, field.valueEnd).trim() }))
        .filter(field => field.value.startsWith("{") || field.value.startsWith('"') || /^\d+$/.test(field.value));
      const identity = `@article{${block.key},\n${fields.map(field => `${field.name}=${field.value}`).join(",\n")}\n}`;
      // A title expression may be opaque while a literal DOI still identifies
      // the paper. Import continues to require titles; identity matching does not.
      return parseBibliography(identity, { requireTitle: false }).entries.map(entry => ({ ...entry.paper, id: block.key, citekey: block.key, entry_type: entry.entryType } as BibliographyPaper));
    });
    const matched = matchBibliographyPaper(paper, parsed);
    if (matched) existing = blocks.find(block => block.key === matched.citekey);
  }
  let citekey = existing?.key || citationKeyFor(paper), suffix = 2;
  while (!existing && blocks.some(block => citationKeyIdentity(block.key) === citationKeyIdentity(citekey))) citekey = `${citationKeyFor(paper)}_${suffix++}`;
  const generated = exportBibliography([{ ...paper, citekey }]);
  if (!update) return { content, citekey, changed: false, action: "kept" as const };
  if (!existing) return { content: `${content}${content && !content.endsWith("\n") ? "\n" : ""}\n${marker}\n${generated}`, citekey, changed: true, action: "added" as const };
  const generatedBlock = bibliographyBlocks(generated)[0];
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const additions: string[] = [];
  for (const field of generatedBlock.fields) {
    const value = generated.slice(field.valueStart, field.valueEnd);
    // Keep the manuscript's choice of journal/booktitle field and every
    // handwritten field the library does not supply.
    const venueAlias = field.name === "journal" ? "booktitle" : field.name === "booktitle" ? "journal" : undefined;
    const current = existing.fields.find(item => item.name === field.name) ?? existing.fields.find(item => item.name === venueAlias);
    if (current) replacements.push({ start: current.valueStart, end: current.valueEnd, value });
    else additions.push(`  ${field.name} = ${value}`);
  }
  if (additions.length) {
    const separator = hasTrailingFieldSeparator(content, existing) ? "" : ",";
    replacements.push({ start: existing.fieldsEnd, end: existing.fieldsEnd, value: `${separator}\n${additions.join(",\n")}\n` });
  }
  if (markerAt < 0) replacements.push({ start: existing.start, end: existing.start, value: `${marker}\n` });
  let next = content;
  for (const change of replacements.sort((a, b) => b.start - a.start)) next = next.slice(0, change.start) + change.value + next.slice(change.end);
  return { content: next, citekey, changed: next !== content, action: "updated" as const };
}

export function manuscriptBibliographyPaths(content: string, mainPath: string) {
  const base = mainPath.split("/").slice(0, -1).join("/");
  const names = [...content.matchAll(/\\(?:bibliography|addbibresource)(?:\[[^\]]*\])?\{([^}]+)\}/g)].flatMap(match => match[1].split(","));
  return [...new Set(names.map(name => name.trim()).filter(name => name && !name.startsWith("/") && !name.split(/[\\/]/).includes("..")).map(name => `${base ? `${base}/` : ""}${name.endsWith(".bib") ? name : `${name}.bib`}`))];
}
