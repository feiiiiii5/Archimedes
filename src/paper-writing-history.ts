export type ManuscriptVersionScope = {
  dataRoot?: string;
  projectId: string;
  workspaceId: string;
  executionRoot: string;
  threadId?: string | null;
};
export type ManuscriptVersionOwner = ManuscriptVersionScope & { mainPath: string };
export type ManuscriptVersion = ManuscriptVersionOwner & {
  id: string;
  name: string;
  sourceVersion: string;
  createdAt: string;
  files: Array<{ path: string; sha256: string; bytes: number }>;
  totalBytes: number;
};
export type ManuscriptVersionComparison = {
  version: ManuscriptVersion;
  currentSourceVersion: string;
  changes: Array<{ path: string; status: "added" | "removed" | "modified"; binary: boolean; patch: string }>;
};
export type PaperWritingBridge = {
  listManuscriptVersions(scope: ManuscriptVersionScope & { mainPath?: string }): Promise<ManuscriptVersion[]>;
  saveManuscriptVersion(input: ManuscriptVersionOwner & { name: string }): Promise<ManuscriptVersion>;
  compareManuscriptVersion(input: ManuscriptVersionOwner & { id: string }): Promise<ManuscriptVersionComparison>;
  restoreManuscriptVersion(input: ManuscriptVersionOwner & { id: string; expectedSourceVersion: string }): Promise<{ version: ManuscriptVersion; restoredPaths: string[]; removedPaths: string[]; previousVersion: ManuscriptVersion | null }>;
};
