// Shared by the phone (which uploads a deck file) and the server (which reads it).

export const ANKI_DECK_MAX_BYTES = 50 * 1024 * 1024;

export function ankiDeckPathPrefix(userId: string): string {
  return `${userId}/decks/`;
}

export function ankiDeckPath(userId: string, uploadId: string, fileName: string): string {
  const ext = /\.(apkg|colpkg|txt|tsv|csv)$/i.exec(fileName)?.[1]?.toLowerCase() ?? "apkg";
  return `${ankiDeckPathPrefix(userId)}${uploadId}.${ext}`;
}
