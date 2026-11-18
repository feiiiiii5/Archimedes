import { useEffect, useMemo, useState } from "react";
import { BookOpen, LoaderCircle, Search, X } from "lucide-react";
import { Dialog } from "./Dialog";
import { useUISettings } from "./i18n";
import { citationKeyFor } from "./paper-writing-citations";
import type { BibliographyPaper } from "./bibliography";
import "./paper-writing-citations.css";

export type CitationAction = "insert-update" | "update" | "insert";

export default function PaperWritingCitations({ bridge, projectId, mainPath, bibliographyPaths, insertionDisabled, onClose, onApply }: {
  bridge: ResearchDeskBridge;
  projectId: string;
  mainPath: string;
  bibliographyPaths: string[];
  insertionDisabled: boolean;
  onClose(): void;
  onApply(paper: BibliographyPaper, path: string, action: CitationAction): Promise<string>;
}) {
  const { t } = useUISettings();
  const root = mainPath.split("/").slice(0, -1).join("/");
  const [papers, setPapers] = useState<BibliographyPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [target, setTarget] = useState(bibliographyPaths[0] || `${root ? `${root}/` : ""}references.bib`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    void bridge.listLibraries(projectId).then(libraries => Promise.all(libraries.map(library => bridge.listLibraryPapers(library.id)))).then(groups => {
      if (!live) return;
      const found = [...new Map(groups.flat().map(paper => [paper.id, paper])).values()];
      setPapers(found); setSelected(found[0]?.id || "");
    }).catch(reason => { if (live) setError(String(reason)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [bridge, projectId]);
  const results = useMemo(() => papers.filter(paper => `${paper.title} ${paper.authors.join(" ")} ${paper.year || ""} ${paper.doi} ${citationKeyFor(paper)}`.toLowerCase().includes(query.toLowerCase())), [papers, query]);
  const paper = results.find(item => item.id === selected);
  async function apply(action: CitationAction) {
    if (!paper || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const message = await onApply(paper, target.trim(), action);
      setNotice(message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <Dialog open onClose={() => { if (!busy) onClose(); }} size="lg" ariaLabel={t("Manuscript citations")} className="paper-citations-dialog">
    <header className="app-dialog-header"><div><h2>{t("Manuscript citations")}</h2><p>{t("Find a paper in this project's library. Choose when to update the manuscript bibliography.")}</p></div><button className="app-dialog-close" disabled={busy} onClick={onClose} aria-label={t("Close citations")}><X size={16} /></button></header>
    <div className="app-dialog-body paper-citations-body">
      <label className="paper-citation-search"><Search size={15} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Search title, author or citation key")} aria-label={t("Search project references")} /></label>
      <div className="paper-citation-results" aria-label={t("Project references")}>{loading ? <p><LoaderCircle size={15} className="spin" />{t("Loading project references…")}</p> : results.length ? results.map(item => <button key={item.id} className={selected === item.id ? "paper-citation-result active" : "paper-citation-result"} onClick={() => { setSelected(item.id); setNotice(""); }}><BookOpen size={15} /><span><strong>{item.title}</strong><small>{item.authors.join(", ")} · {item.year || "—"} · {citationKeyFor(item)}</small></span></button>) : <p>{t("No matching project references. Add papers to this project's library first.")}</p>}</div>
      <label className="paper-citation-target">{t("Manuscript .bib file")}<input value={target} onChange={event => setTarget(event.target.value)} list="paper-bibliography-paths" aria-label={t("Manuscript .bib file")} /><datalist id="paper-bibliography-paths">{bibliographyPaths.map(name => <option key={name} value={name} />)}</datalist></label>
      {paper && <p className="paper-citation-hint">{t("Citation key")}: <code>{citationKeyFor(paper)}</code>. {t("An existing matching entry keeps its manuscript key and hand-written fields; only supplied metadata is updated.")}</p>}
      {insertionDisabled && <p className="paper-citation-hint">{t("Turn off Co-edit to insert a citation.")}</p>}
      {error && <p role="alert" className="paper-citation-error">{t(error)}</p>}{notice && <p role="status">{notice}</p>}
    </div>
    <footer className="app-dialog-footer"><button className="secondary-button" disabled={busy || !paper || insertionDisabled} onClick={() => void apply("insert")}>{t("Insert citation only")}</button><button className="secondary-button" disabled={busy || !paper} onClick={() => void apply("update")}>{t("Update .bib only")}</button><button className="primary-button" disabled={busy || !paper || insertionDisabled} onClick={() => void apply("insert-update")}>{busy ? <LoaderCircle className="spin" size={14} /> : null}{t("Insert citation and update .bib")}</button></footer>
  </Dialog>;
}
