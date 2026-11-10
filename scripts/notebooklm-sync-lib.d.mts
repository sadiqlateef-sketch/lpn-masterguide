// Types for notebooklm-sync-lib.mjs, so the TypeScript tests can import it.

export type NoteFile = { key: string; abs: string; size: number; mtimeMs: number; mediaType: string };
export type RemoteSource = { id: string; externalKey: string | null; contentHash: string | null };
export type SyncOptions = {
  folder: string | null;
  app: string | null;
  watch: number | null;
  prune: boolean;
  dryRun: boolean;
  help: boolean;
};

export const NOTE_EXTENSIONS: Record<string, string>;
export const MAX_FILE_BYTES: number;
export function mediaTypeFor(name: string): string | null;
export function listNoteFiles(folder: string): { files: NoteFile[]; tooBig: NoteFile[] };
export function hashBytes(bytes: Uint8Array | string): string;
export function hashFile(abs: string): string;
export function planSync<L extends { key: string; hash: string | null }, R extends RemoteSource>(
  local: L[],
  remote: R[],
  options?: { prune?: boolean },
): { upload: (L & { replaces: string | null })[]; unchanged: L[]; remove: R[] };
export function isSettled(file: { mtimeMs: number }, now?: number, settleMs?: number): boolean;
export function parseArgs(argv: string[]): SyncOptions;
export function parseEnvFile(text: string): Record<string, string>;
