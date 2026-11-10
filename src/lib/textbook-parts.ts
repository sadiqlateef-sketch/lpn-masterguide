// Shared by the phone (which splits and uploads a textbook PDF) and the server (which reads it part by part).
// Big books go straight to Storage in parts, because a request to the app's API can only carry a few MB.

export const TEXTBOOK_PART_TARGET_BYTES = 20 * 1024 * 1024;
export const TEXTBOOK_PART_MAX_BYTES = 45 * 1024 * 1024;
export const TEXTBOOK_MAX_PARTS = 40;
export const TEXTBOOK_MAX_BYTES = 400 * 1024 * 1024;

export function textbookPartPath(userId: string, textbookId: string, part: number): string {
  return `${userId}/textbooks/${textbookId}/part-${part}.pdf`;
}

export type PageRange = { from: number; to: number };

// Splits a book into page ranges of roughly equal size, aiming for TEXTBOOK_PART_TARGET_BYTES each.
export function planSplit(totalBytes: number, pageCount: number): PageRange[] {
  if (pageCount < 1) return [];
  const parts = Math.min(TEXTBOOK_MAX_PARTS, pageCount, Math.max(1, Math.ceil(totalBytes / TEXTBOOK_PART_TARGET_BYTES)));
  const perPart = Math.ceil(pageCount / parts);
  const ranges: PageRange[] = [];
  for (let from = 1; from <= pageCount; from += perPart) ranges.push({ from, to: Math.min(pageCount, from + perPart - 1) });
  return ranges;
}

// Halves a range that came out too big (pictures cluster in some chapters). Returns null for a single page.
export function halveRange(range: PageRange): [PageRange, PageRange] | null {
  if (range.to <= range.from) return null;
  const mid = Math.floor((range.from + range.to) / 2);
  return [
    { from: range.from, to: mid },
    { from: mid + 1, to: range.to },
  ];
}
