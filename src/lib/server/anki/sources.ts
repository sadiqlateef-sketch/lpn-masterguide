import type { SourceQuote } from "@/lib/api-types";
import { check, type UserContext } from "../supabase";
import { pageLabel } from "../text/pdf-chunk";

// The student's own textbook passages and notes, numbered, that a card is checked against or built from.

export type NumberedSource = { id: string; kind: "note" | "textbook"; label: string; text: string };

const MAX_SOURCE_TEXT = 2500;

// Lowercased words only, so a quote still matches across line breaks, curly quotes and spacing.
export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[^\p{L}\p{N}%.]+/gu, " ")
    // A full stop between digits is a decimal point and stays; any other is just punctuation.
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MIN_QUOTE_CHARS = 8;

export function quoteInSource(quote: string, source: string): boolean {
  const q = normalizeForQuote(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  return normalizeForQuote(source).includes(q);
}

// Keeps the quotes that appear word for word in the source they name. `bad` counts the rest.
export function checkedQuotes(
  quotes: readonly { source: number; quote: string }[],
  sources: readonly NumberedSource[],
): { refs: SourceQuote[]; bad: number } {
  const refs: SourceQuote[] = [];
  let bad = 0;
  for (const q of quotes) {
    const source = Number.isInteger(q.source) ? sources[q.source] : undefined;
    if (!source || !quoteInSource(q.quote, source.text)) {
      bad++;
      continue;
    }
    const quote = q.quote.replace(/\s+/g, " ").trim().slice(0, 400);
    if (!refs.some((r) => r.label === source.label && r.quote === quote)) refs.push({ kind: source.kind, label: source.label, quote });
  }
  return { refs, bad };
}

export function sourcesBlock(sources: readonly NumberedSource[]): string {
  return sources.length ? sources.map((s, i) => `[${i}] ${s.label}\n${s.text}`).join("\n\n") : "No sources.";
}

type MatchedPassage = { id: string; textbook_id: string; page_from: number; page_to: number; content: string };
type MatchedNote = { id: string; source_id: string; content: string };

export class SourcePool {
  readonly sources: NumberedSource[] = [];
  private chars = 0;
  constructor(private readonly maxChars: number) {}

  // Adds a source once. Returns its number, or null when the pool is full.
  add(source: NumberedSource): number | null {
    const existing = this.sources.findIndex((s) => s.id === source.id);
    if (existing >= 0) return existing;
    const text = source.text.slice(0, MAX_SOURCE_TEXT);
    if (this.chars + text.length > this.maxChars) return null;
    this.sources.push({ ...source, text });
    this.chars += text.length;
    return this.sources.length - 1;
  }
}

// Passages and notes close to each vector, labelled with their book and pages or notebook.
export async function nearestSources(
  ctx: UserContext,
  vectors: readonly string[],
  opts: { passages: number; notes: number },
): Promise<{ passages: (NumberedSource & { similarity?: number })[]; notes: NumberedSource[] }[]> {
  const matches = await Promise.all(
    vectors.map(async (v) => {
      const [p, n] = await Promise.all([
        ctx.supabase.rpc("match_textbook_chunks", { query_embedding: v, match_count: opts.passages, min_similarity: 0.45 }),
        ctx.supabase.rpc("match_note_chunks", { query_embedding: v, match_count: opts.notes, min_similarity: 0.5 }),
      ]);
      return { passages: check(p, "find passages") as MatchedPassage[], notes: check(n, "find notes") as MatchedNote[] };
    }),
  );

  const bookIds = [...new Set(matches.flatMap((m) => m.passages.map((p) => p.textbook_id)))];
  const noteIds = [...new Set(matches.flatMap((m) => m.notes.map((n) => n.source_id)))];
  const [books, noteSources] = await Promise.all([
    bookIds.length ? ctx.supabase.from("textbooks").select("id, title").in("id", bookIds) : Promise.resolve({ data: [], error: null }),
    noteIds.length
      ? ctx.supabase.from("note_sources").select("id, title, notebooks(name)").in("id", noteIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const bookTitle = new Map((check(books, "load books") as { id: string; title: string }[]).map((b) => [b.id, b.title]));
  const noteLabel = new Map(
    (check(noteSources, "load note sources") as unknown as { id: string; title: string; notebooks: { name: string } | null }[]).map((s) => [
      s.id,
      `${s.notebooks?.name ?? "My notes"}: ${s.title}`,
    ]),
  );

  return matches.map((m) => ({
    passages: m.passages.map((p) => ({
      id: p.id,
      kind: "textbook" as const,
      label: `${bookTitle.get(p.textbook_id) ?? "Your textbook"}, ${pageLabel(p.page_from, p.page_to)}`,
      text: p.content,
    })),
    notes: m.notes.map((n) => ({ id: n.id, kind: "note" as const, label: noteLabel.get(n.source_id) ?? "My notes", text: n.content })),
  }));
}
