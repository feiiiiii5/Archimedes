export type ComposerRequest = { id: string; text: string; mode?: "append" | "replace" };
export type ComposerSession<T> = { items: T[]; request: ComposerRequest | null; error: string };
export type ComposerSessions<T> = Record<string, ComposerSession<T>>;
/** A submitted draft key whose late updates now belong to the created session. */
export type ComposerKeyAliases = Record<string, string>;

export function getComposerSession<T>(sessions: ComposerSessions<T>, key: string): ComposerSession<T> {
  return sessions[key] ?? { items: [], request: null, error: "" };
}

export function resolveComposerKey(aliases: ComposerKeyAliases, key: string): string {
  return aliases[key] ?? key;
}

export function updateComposerSession<T>(sessions: ComposerSessions<T>, key: string, update: (session: ComposerSession<T>) => ComposerSession<T>): ComposerSessions<T> {
  return { ...sessions, [key]: update(getComposerSession(sessions, key)) };
}

export function appendComposerText(current: string, text: string): string {
  return current.trim() ? `${current.trimEnd()}\n\n${text}` : text;
}
