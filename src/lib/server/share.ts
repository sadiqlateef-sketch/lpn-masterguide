import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { AttemptRequest, LessonCardView, PracticeView, SharedDeckView, SharedGrade, ShareKind, ShareLinkView } from "@/lib/api-types";
import type { Bowtie } from "./ai-schemas";
import { env } from "./env";
import { ApiError } from "./http";
import { getLesson } from "./lessons";
import { grade, PRACTICE_COLUMNS, toPracticeView, type PracticePayload, type PracticeRow, type PracticeItemType } from "./practice";
import { check, type UserContext } from "./supabase";

// Share a deck (F20): a read-only link to a lesson or a stone's question set. The link holds a copy
// taken when it's made, with no notebook card, no source captions and no question origins, so the
// student's own notes never leave. Links run out after 30 days and can be turned off at any time.
// Whoever opens one can answer the questions; each answer is checked on the server and nothing is saved.

export const SHARE_DAYS = 30;
const MAX_ITEMS = 40;
const MAX_LINKS = 200;

type SnapshotCard = { kind: LessonCardView["kind"]; title: string; body?: string; bullets?: string[] };
type SnapshotItem = { id: string; item_type: PracticeItemType; payload: PracticePayload };
export type Snapshot = { cards: SnapshotCard[]; items: SnapshotItem[] };

export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{32,64}$/.test(token);
}

// Copies only the fields a question needs to be shown and checked.
export function sharedPayload(type: PracticeItemType, payload: PracticePayload): PracticePayload {
  const p = payload as unknown as Record<string, unknown>;
  const pick = (keys: string[]) => Object.fromEntries(keys.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])) as unknown as PracticePayload;
  switch (type) {
    case "ngn_mini_bowtie": {
      const b = payload as Bowtie;
      return { scenario: b.scenario, condition: b.condition, actions: b.actions, parameters: b.parameters, rationale: b.rationale };
    }
    case "ngn_matrix":
      return pick(["stem", "columns", "rows", "answers", "rationale"]);
    case "ngn_cloze":
      return pick(["stem", "text", "blanks", "rationale"]);
    case "ngn_highlight":
      return pick(["stem", "segments", "correct_ids", "rationale"]);
    case "ngn_ordered":
      return pick(["stem", "items", "correct_order", "rationale"]);
    default:
      return pick(["stem", "options", "correct_option_ids", "rationale", "option_rationales", "lpn_scope_note"]);
  }
}

// Lesson cards without the notebook card, Quick Play's placeholder or any caption.
export function sharedCards(cards: readonly LessonCardView[]): SnapshotCard[] {
  return cards
    .filter((c) => c.kind !== "notebooklm" && c.kind !== "quick_play")
    .map((c) => ({
      kind: c.kind,
      title: c.title,
      ...(c.body ? { body: c.body } : {}),
      ...(c.bullets?.length ? { bullets: c.bullets } : {}),
    }));
}

// Questions written from a missed question bank item stay private, along with where any came from.
export function sharedItems(rows: readonly PracticeRow[]): SnapshotItem[] {
  return rows
    .filter((r) => !r.origin_question_id)
    .slice(0, MAX_ITEMS)
    .map((r, i) => ({ id: `q${i + 1}`, item_type: r.item_type, payload: sharedPayload(r.item_type, r.payload) }));
}

type LinkRow = {
  id: string;
  token: string;
  kind: ShareKind;
  title: string;
  stone_id: string | null;
  item_count: number;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

const LINK_COLUMNS = "id, token, kind, title, stone_id, item_count, created_at, expires_at, revoked_at";

function toLinkView(r: LinkRow): ShareLinkView {
  return { id: r.id, token: r.token, kind: r.kind, title: r.title, stoneId: r.stone_id, itemCount: r.item_count, createdAt: r.created_at, expiresAt: r.expires_at, revokedAt: r.revoked_at };
}

export async function listShareLinks(ctx: UserContext): Promise<ShareLinkView[]> {
  const rows = check(await ctx.supabase.from("shared_decks").select(LINK_COLUMNS).order("created_at", { ascending: false }).limit(MAX_LINKS), "load share links") as LinkRow[];
  return rows.map(toLinkView);
}

export async function createShareLink(ctx: UserContext, kind: ShareKind, stoneId: string): Promise<ShareLinkView> {
  const stone = check(await ctx.supabase.from("stepping_stones").select("id, title").eq("id", stoneId).maybeSingle(), "load stone") as { id: string; title: string } | null;
  if (!stone) throw new ApiError(404, "That stepping stone isn't here anymore.", "not_found");

  let snapshot: Snapshot;
  if (kind === "lesson") {
    const lesson = await getLesson(ctx, stoneId);
    const ids = lesson.practice.map((p) => p.id);
    const rows = ids.length ? (check(await ctx.supabase.from("practice_items").select(PRACTICE_COLUMNS).in("id", ids), "load lesson questions") as PracticeRow[]) : [];
    snapshot = { cards: sharedCards(lesson.cards), items: sharedItems(ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is PracticeRow => Boolean(r))) };
  } else {
    const rows = check(
      await ctx.supabase.from("practice_items").select(PRACTICE_COLUMNS).eq("stone_id", stoneId).order("created_at").limit(MAX_ITEMS * 2),
      "load stone questions",
    ) as PracticeRow[];
    snapshot = { cards: [], items: sharedItems(rows) };
  }
  if (!snapshot.cards.length && !snapshot.items.length) throw new ApiError(409, "There's nothing to share on this stone yet. Open its lesson first.", "nothing_to_share");

  const now = Date.now();
  const row = check(
    await ctx.supabase
      .from("shared_decks")
      .insert({
        user_id: ctx.user.id,
        token: newShareToken(),
        kind,
        title: `${stone.title}${kind === "questions" ? ": questions" : ""}`.slice(0, 160),
        stone_id: stoneId,
        snapshot,
        item_count: snapshot.items.length,
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + SHARE_DAYS * 86_400_000).toISOString(),
      })
      .select(LINK_COLUMNS)
      .single(),
    "save share link",
  ) as LinkRow;
  return toLinkView(row);
}

export async function revokeShareLink(ctx: UserContext, id: string): Promise<ShareLinkView> {
  const row = check(
    await ctx.supabase.from("shared_decks").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null).select(LINK_COLUMNS).maybeSingle(),
    "turn off share link",
  ) as LinkRow | null;
  if (row) return toLinkView(row);
  const existing = check(await ctx.supabase.from("shared_decks").select(LINK_COLUMNS).eq("id", id).maybeSingle(), "load share link") as LinkRow | null;
  if (!existing) throw new ApiError(404, "That link isn't here anymore.", "not_found");
  return toLinkView(existing);
}

// ---------------------------------------------------------------------------
// Opening a link: no sign-in. The database hands back one live copy by its token, and nothing else.
// ---------------------------------------------------------------------------

type DeckRow = { kind: ShareKind; title: string; snapshot: Snapshot; created_at: string; expires_at: string };

async function loadShared(token: string): Promise<DeckRow> {
  if (!isShareToken(token)) throw new ApiError(404, "This link doesn't work. Ask for a new one.", "not_found");
  const anon = createClient(env.supabaseUrl(), env.supabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const rows = check(await anon.rpc("shared_deck", { p_token: token }), "open share link") as DeckRow[] | null;
  const row = rows?.[0];
  if (!row) throw new ApiError(404, "This link has run out or been turned off. Ask for a new one.", "not_found");
  return row;
}

function asRow(item: SnapshotItem): PracticeRow {
  return { id: item.id, stone_id: null, item_type: item.item_type, origin_question_id: null, payload: item.payload };
}

export async function openSharedDeck(token: string): Promise<SharedDeckView> {
  const row = await loadShared(token);
  const items: PracticeView[] = (row.snapshot.items ?? []).map((i) => toPracticeView(asRow(i)));
  return { kind: row.kind, title: row.title, createdAt: row.created_at, expiresAt: row.expires_at, cards: row.snapshot.cards ?? [], items };
}

export async function gradeSharedAnswer(token: string, request: AttemptRequest): Promise<SharedGrade> {
  const row = await loadShared(token);
  const item = (row.snapshot.items ?? []).find((i) => i.id === request.itemId);
  if (!item) throw new ApiError(404, "That question isn't in this set.", "not_found");
  const { itemId: _itemId, ...answer } = request;
  const { selectedIds: _selected, ...result } = grade(asRow(item), answer);
  return result;
}
