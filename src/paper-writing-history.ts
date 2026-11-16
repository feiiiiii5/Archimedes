export type ManuscriptVersionOwner = {
  dataRoot?: string;
  projectId: string;
  workspaceId: string;
  executionRoot: string;
  mainPath: string;
  threadId?: string | null;
};
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
  listManuscriptVersions(owner: ManuscriptVersionOwner): Promise<ManuscriptVersion[]>;
  saveManuscriptVersion(input: ManuscriptVersionOwner & { name: string }): Promise<ManuscriptVersion>;
  compareManuscriptVersion(input: ManuscriptVersionOwner & { id: string }): Promise<ManuscriptVersionComparison>;
  restoreManuscriptVersion(input: ManuscriptVersionOwner & { id: string; expectedSourceVersion: string }): Promise<{ version: ManuscriptVersion; restoredPaths: string[]; removedPaths: string[]; previousVersion: ManuscriptVersion | null }>;
};
