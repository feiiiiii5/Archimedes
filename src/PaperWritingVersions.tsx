import { useEffect, useState } from "react";
import { History, LoaderCircle, X } from "lucide-react";
import { Dialog } from "./Dialog";
import { useUISettings } from "./i18n";
import type { ManuscriptVersion, ManuscriptVersionComparison } from "./paper-writing-history";
import "./paper-writing-continuity.css";

function versionErrorMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return message
    .replace(/^Error:\s*/, "")
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim() || "Could not prepare the manuscript key version.";
}

const parameterizedVersionErrors = [
  [/^A directory blocking restoration contains unsaved material: (?<path>[\s\S]+)$/, "A directory blocking restoration contains unsaved material: {path}"],
  [/^Could not finish restoring\. Original files are available in (?<recovery>[\s\S]+)$/, "Could not finish restoring. Original files are available in {recovery}"],
  [/^The folder "(?<folder>[\s\S]+)" is no longer available\. Rebind the project folder and try again\.$/, 'The folder "{folder}" is no longer available. Rebind the project folder and try again.'],
  [/^The original path is now occupied: (?<path>[\s\S]+)$/, "The original path is now occupied: {path}"],
  [/^The restored file is blocked by (?<path>[\s\S]+)\.$/, "The restored file is blocked by {path}."],
  [/^The saved version file has changed: (?<path>[\s\S]+)$/, "The saved version file has changed: {path}"],
  [/^Text files are limited to (?<bytes>\d+) bytes\.$/, "Text files are limited to {bytes} bytes."],
  [/^Text preview is limited to (?<bytes>\d+) bytes\.$/, "Text preview is limited to {bytes} bytes."],
] as const;

function localizeVersionError(message: string, t: ReturnType<typeof useUISettings>["t"]) {
  for (const [pattern, key] of parameterizedVersionErrors) {
    const values = pattern.exec(message)?.groups;
    if (values) return t(key, values);
  }
  return t(message);
}

export default function PaperWritingVersions({ executionRoot, onClose, onList, onSave, onCompare, onRestore }: {
  executionRoot: string;
  onClose(): void;
  onList(): Promise<ManuscriptVersion[]>;
  onSave?(name: string): Promise<ManuscriptVersion>;
  onCompare(version: ManuscriptVersion): Promise<ManuscriptVersionComparison>;
  onRestore(comparison: ManuscriptVersionComparison): Promise<void>;
}) {
  const { t } = useUISettings();
  const [versions, setVersions] = useState<ManuscriptVersion[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [comparison, setComparison] = useState<ManuscriptVersionComparison | null>(null);
  const comparisonFolder = comparison?.version.executionRoot;
  const historicalComparison = comparisonFolder && comparisonFolder !== executionRoot;
  useEffect(() => {
    let live = true;
    setBusy(true);
    void onList().then(found => { if (live) setVersions(found); }).catch(reason => { if (live) setError(versionErrorMessage(reason)); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, []);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (reason) { setError(versionErrorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <Dialog open onClose={() => { if (!busy) onClose(); }} size="lg" ariaLabel={t("Manuscript key versions")} className="paper-versions-dialog">
    <header className="app-dialog-header"><div><h2>{t("Manuscript key versions")}</h2><p>{onSave ? t("Name a meaningful manuscript state, compare its files and return to it later.") : t("Choose a saved key version to compare or restore its files.")}</p></div><button className="app-dialog-close" disabled={busy} onClick={onClose} aria-label={t("Close key versions")}><X size={16} /></button></header>
    <div className="app-dialog-body paper-versions-body">
      {onSave && <>
        <form className="paper-version-save" onSubmit={event => {
          event.preventDefault();
          void run(async () => {
            const saved = await onSave(name.trim());
            setVersions(await onList());
            setName("");
            setComparison(await onCompare(saved));
            setNotice(t("Key version saved with its source files."));
          });
        }}>
          <label>{t("Version name")}<input autoFocus value={name} maxLength={120} disabled={busy} onChange={event => setName(event.target.value)} placeholder={t("For example: First complete draft")} /></label>
          <button className="primary-button" disabled={busy || !name.trim()} type="submit">{t("Save key version")}</button>
        </form>
        <p className="paper-continuity-hint">{t("Includes the manuscript folder's source, bibliography and assets. Generated build folders are excluded.")}</p>
      </>}
      <div className="paper-version-list" aria-label={t("Saved key versions")}>
        {versions.length ? versions.map(version => <button key={version.id} className={comparison?.version.id === version.id ? "paper-version-row active" : "paper-version-row"} disabled={busy} onClick={() => void run(async () => setComparison(await onCompare(version)))}>
          <History size={15} /><span><strong>{version.name}</strong><small>{version.mainPath} · {new Date(version.createdAt).toLocaleString()} · {t("{count} files", { count: version.files.length })} · {version.sourceVersion.slice(0, 10)}</small>{version.executionRoot !== executionRoot && <small>{t("Saved in {folder}", { folder: version.executionRoot })}</small>}</span><span>{t("Compare")}</span>
        </button>) : <p>{busy ? t("Loading key versions…") : t("No key versions saved yet.")}</p>}
      </div>
      {comparison && <section className="paper-version-comparison" aria-label={t("Version comparison")}><h3>{comparison.version.name} → {t("Current manuscript")}</h3>{historicalComparison && <p>{t("This comparison and any restore apply to {folder}.", { folder: comparisonFolder })}</p>}{comparison.changes.length ? <><p>{t("Restoring replaces the changed files below and removes files added since this version. The current content is kept as a return version.")}</p>{comparison.changes.map(change => <details key={change.path} open={comparison.changes.length === 1}><summary><b>{t(change.status === "added" ? "Added" : change.status === "removed" ? "Removed" : "Modified")}</b> {change.path}</summary>{change.binary ? <p>{t("Binary asset changed. Restoring uses the saved file bytes.")}</p> : <pre tabIndex={0}>{change.patch}</pre>}</details>)}</> : <p>{t("The current manuscript matches this key version.")}</p>}<button className="secondary-button" disabled={busy} onClick={() => void run(async () => setComparison(await onCompare(comparison.version)))}>{t("Refresh comparison")}</button><button className="primary-button" disabled={busy || !comparison.changes.length} onClick={() => void run(async () => { await onRestore(comparison); setVersions(await onList()); setComparison(await onCompare(comparison.version)); setNotice(historicalComparison ? t("Key version restored in {folder}.", { folder: comparisonFolder }) : t("Key version restored. Continue editing or recompile the manuscript.")); })}>{t("Restore this key version")}</button></section>}
      {busy && <p role="status"><LoaderCircle size={14} className="spin" />{t("Preparing manuscript files…")}</p>}{error && <p role="alert" className="paper-continuity-error">{localizeVersionError(error, t)}</p>}{notice && <p role="status">{notice}</p>}
    </div>
  </Dialog>;
}
