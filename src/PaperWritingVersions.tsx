import { useEffect, useState } from "react";
import { History, LoaderCircle, X } from "lucide-react";
import { Dialog } from "./Dialog";
import { useUISettings } from "./i18n";
import type { ManuscriptVersion, ManuscriptVersionComparison } from "./paper-writing-history";
import "./paper-writing-continuity.css";

export default function PaperWritingVersions({ initialId, onClose, onList, onSave, onCompare, onRestore }: {
  initialId?: string;
  onClose(): void;
  onList(): Promise<ManuscriptVersion[]>;
  onSave(name: string): Promise<ManuscriptVersion>;
  onCompare(id: string): Promise<ManuscriptVersionComparison>;
  onRestore(comparison: ManuscriptVersionComparison): Promise<void>;
}) {
  const { t } = useUISettings();
  const [versions, setVersions] = useState<ManuscriptVersion[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [comparison, setComparison] = useState<ManuscriptVersionComparison | null>(null);
  useEffect(() => {
    let live = true;
    setBusy(true);
    void onList().then(async found => { if (live) setVersions(found); if (initialId) { const value = await onCompare(initialId); if (live) setComparison(value); } }).catch(reason => { if (live) setError(String(reason)); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, []);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <Dialog open onClose={() => { if (!busy) onClose(); }} size="lg" ariaLabel={t("Manuscript key versions")} className="paper-versions-dialog">
    <header className="app-dialog-header"><div><h2>{t("Manuscript key versions")}</h2><p>{t("Name a meaningful manuscript state, compare its files and return to it later.")}</p></div><button className="app-dialog-close" disabled={busy} onClick={onClose} aria-label={t("Close key versions")}><X size={16} /></button></header>
    <div className="app-dialog-body paper-versions-body">
      <form className="paper-version-save" onSubmit={event => { event.preventDefault(); void run(async () => { const saved = await onSave(name.trim()); setVersions(await onList()); setName(""); setComparison(await onCompare(saved.id)); setNotice(t("Key version saved with its source files.")); }); }}><label>{t("Version name")}<input autoFocus value={name} maxLength={120} disabled={busy} onChange={event => setName(event.target.value)} placeholder={t("For example: First complete draft")} /></label><button className="primary-button" disabled={busy || !name.trim()} type="submit">{t("Save key version")}</button></form>
      <p className="paper-continuity-hint">{t("Includes the manuscript folder's source, bibliography and assets. Generated build folders are excluded.")}</p>
      <div className="paper-version-list" aria-label={t("Saved key versions")}>{versions.length ? versions.map(version => <button key={version.id} className={comparison?.version.id === version.id ? "paper-version-row active" : "paper-version-row"} disabled={busy} onClick={() => void run(async () => setComparison(await onCompare(version.id)))}><History size={15} /><span><strong>{version.name}</strong><small>{new Date(version.createdAt).toLocaleString()} · {t("{count} files", { count: version.files.length })} · {version.sourceVersion.slice(0, 10)}</small></span><span>{t("Compare")}</span></button>) : <p>{busy ? t("Loading key versions…") : t("No key versions saved yet.")}</p>}</div>
      {comparison && <section className="paper-version-comparison" aria-label={t("Version comparison")}><h3>{comparison.version.name} → {t("Current manuscript")}</h3>{comparison.changes.length ? <><p>{t("Restoring replaces the changed files below and removes files added since this version. The current content is kept as a return version.")}</p>{comparison.changes.map(change => <details key={change.path} open={comparison.changes.length === 1}><summary><b>{t(change.status === "added" ? "Added" : change.status === "removed" ? "Removed" : "Modified")}</b> {change.path}</summary>{change.binary ? <p>{t("Binary asset changed. Restoring uses the saved file bytes.")}</p> : <pre tabIndex={0}>{change.patch}</pre>}</details>)}</> : <p>{t("The current manuscript matches this key version.")}</p>}<button className="secondary-button" disabled={busy} onClick={() => void run(async () => setComparison(await onCompare(comparison.version.id)))}>{t("Refresh comparison")}</button><button className="primary-button" disabled={busy || !comparison.changes.length} onClick={() => void run(async () => { await onRestore(comparison); setVersions(await onList()); setComparison(await onCompare(comparison.version.id)); setNotice(t("Key version restored. Continue editing or recompile the manuscript.")); })}>{t("Restore this key version")}</button></section>}
      {busy && <p role="status"><LoaderCircle size={14} className="spin" />{t("Preparing manuscript files…")}</p>}{error && <p role="alert" className="paper-continuity-error">{t(error)}</p>}{notice && <p role="status">{notice}</p>}
    </div>
  </Dialog>;
}
