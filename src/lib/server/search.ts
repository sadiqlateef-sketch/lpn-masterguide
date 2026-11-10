import type { SearchResult, SearchResultKind, StoneStatus } from "@/lib/api-types";
import { embedOne, toPgVector } from "./embeddings";
import { ApiError } from "./http";
import { check, type UserContext } from "./supabase";

// One search box for stones, notes, textbook passages and saved questions, by meaning and by words.

export const MIN_QUERY = 2;
export const MAX_QUERY = 120;
const SNIPPET_CHARS = 200;

export function cleanQuery(q: string | null): string {
  const clean = (q ?? "").replace(/\s+/g, " ").trim();
  if (clean.length < MIN_QUERY) throw new ApiError(400, "Type at least two letters.", "short_query");
  if (clean.length > MAX_QUERY) throw new ApiError(400, "That search is too long.", "long_query");
  return clean;
}

// A short excerpt, starting near the first word of the query when it appears.
export function snippetFor(text: string, query: string): string {
  const flat = text.replace(/[#*_`>]+/g, "").replace(/\s+/g, " ").trim();
  if (flat.length <= SNIPPET_CHARS) return flat;
  const word = query.toLowerCase().split(" ").find((w) => w.length > 2);
  const at = word ? flat.toLowerCase().indexOf(word) : -1;
  const start = at > 60 ? flat.lastIndexOf(" ", at - 40) + 1 : 0;
  const piece = flat.slice(start, start + SNIPPET_CHARS);
  const cut = piece.length === SNIPPET_CHARS ? piece.slice(0, piece.lastIndexOf(" ")) : piece;
  return `${start > 0 ? "..." : ""}${cut}${start + cut.length < flat.length ? "..." : ""}`;
}

type Hit = { kind: SearchResultKind; id: string; stone_id: string | null; title: string; snippet: string; score: number };
type StoneRow = { id: string; title: string; status: StoneStatus };

export function toResults(hits: readonly Hit[], stones: readonly StoneRow[], query: string): SearchResult[] {
  const byId = new Map(stones.map((s) => [s.id, s]));
  return hits.map((h) => {
    const stone = h.stone_id ? byId.get(h.stone_id) : undefined;
    return {
      kind: h.kind,
      id: h.id,
      stone: stone ? { id: stone.id, title: stone.title, status: stone.status } : null,
      title: h.title,
      snippet: snippetFor(h.snippet, query),
    };
  });
}

export async function searchStudy(ctx: UserContext, rawQuery: string | null): Promise<SearchResult[]> {
  const query = cleanQuery(rawQuery);
  const embedding = toPgVector(await embedOne(query, "query"));
  const hits = check(
    await ctx.supabase.rpc("search_study", { q: query, query_embedding: embedding, match_count: 20 }),
    "search",
  ) as Hit[];
  const stoneIds = [...new Set(hits.map((h) => h.stone_id).filter((id): id is string => Boolean(id)))];
  const stones = stoneIds.length
    ? (check(await ctx.supabase.from("stepping_stones").select("id, title, status").in("id", stoneIds), "load stones") as StoneRow[])
    : [];
  return toResults(hits, stones, query);
}
