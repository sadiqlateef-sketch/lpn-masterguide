import type { DeckCardView, DeckState, DeckView } from "@/lib/api-types";
import { ANKI_DECK_MAX_BYTES, ankiDeckPathPrefix } from "@/lib/anki-paths";
import { embed, toPgVector } from "../embeddings";
import { ApiError } from "../http";
import { check, type UserContext } from "../supabase";
import { buildApkg, DeckFormatError, parseApkg, parseTextExport, type ParsedDeck } from "./apkg";

// Importing a deck, listing decks, raising the fact-check cap, exporting, and a stone's cleared cards.

export const MAX_DECK_FILE_BYTES = ANKI_DECK_MAX_BYTES;
export const MAX_DECK_TEXT_CHARS = 3_000_000;
export const MAX_CHECK_CAP = 2000;
const INSERT_BATCH = 100;
const LINK_THRESHOLD = 0.35;

type DeckRow = {
  id: string;
  name: string;
  file_name: string | null;
  state: DeckState;
  error: string | null;
  card_count: number;
  skipped_count: number;
  check_cap: number;
  checks_used: number;
  created_at: string;
};

const DECK_COLUMNS = "id, name, file_name, state, error, card_count, skipped_count, check_cap, checks_used, created_at";

// A deck's name from its file when the deck itself doesn't carry one.
export function deckNameFrom(parsed: ParsedDeck, fileName: string | null): string {
  const fromFile = fileName?.replace(/\.(apkg|colpkg|txt|tsv|csv)$/i, "").replace(/[_]+/g, " ").trim();
  return (parsed.name || fromFile || "My Anki deck").slice(0, 120);
}

// The text a card is matched to stones with.
export function cardEmbeddingText(card: { front: string; back: string }): string {
  return `${card.front}\n${card.back}`.slice(0, 4000);
}

export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

async function countBy(ctx: UserContext, table: string, deckId: string, filter: (q: any) => any): Promise<number> {
  const { count, error } = await filter(ctx.supabase.from(table).select("id", { count: "exact", head: true }).eq("deck_id", deckId));
  if (error) {
    console.error(`Supabase count ${table} failed:`, error.message);
    throw new ApiError(500, "Loading your deck didn't work. Try again.", "db_error");
  }
  return count ?? 0;
}

async function toView(ctx: UserContext, row: DeckRow): Promise<DeckView> {
  const [filed, checked, flagsPending, suggestionsPending] = await Promise.all([
    countBy(ctx, "deck_cards", row.id, (q) => q.not("stone_id", "is", null)),
    countBy(ctx, "deck_cards", row.id, (q) => q.not("checked_at", "is", null)),
    countBy(ctx, "card_checks", row.id, (q) => q.eq("decision", "pending")),
    countBy(ctx, "card_suggestions", row.id, (q) => q.eq("decision", "pending")),
  ]);
  return {
    id: row.id,
    name: row.name,
    fileName: row.file_name,
    state: row.state,
    error: row.error,
    cards: row.card_count,
    skipped: row.skipped_count,
    filed,
    checked,
    checkCap: row.check_cap,
    checksUsed: row.checks_used,
    flagsPending,
    suggestionsPending,
    createdAt: row.created_at,
  };
}

export async function loadDeckRow(ctx: UserContext, deckId: string): Promise<DeckRow> {
  const row = check(await ctx.supabase.from("decks").select(DECK_COLUMNS).eq("id", deckId).maybeSingle(), "load deck") as DeckRow | null;
  if (!row) throw new ApiError(404, "That deck isn't in your library.", "not_found");
  return row;
}

export async function deckView(ctx: UserContext, deckId: string): Promise<DeckView> {
  return toView(ctx, await loadDeckRow(ctx, deckId));
}

export async function listDecks(ctx: UserContext): Promise<DeckView[]> {
  const rows = check(await ctx.supabase.from("decks").select(DECK_COLUMNS).order("created_at", { ascending: false }), "list decks") as DeckRow[];
  return Promise.all(rows.map((row) => toView(ctx, row)));
}

async function readDeckFile(ctx: UserContext, storagePath: string, fileName: string | null): Promise<ParsedDeck> {
  const prefix = ankiDeckPathPrefix(ctx.user.id);
  if (!storagePath.startsWith(prefix) || !/^[\w-]+\.(apkg|colpkg|txt|tsv|csv)$/i.test(storagePath.slice(prefix.length))) {
    throw new ApiError(400, "That upload isn't in your deck folder.", "bad_path");
  }
  const download = await ctx.supabase.storage.from("uploads").download(storagePath);
  if (download.error || !download.data) throw new ApiError(404, "The deck didn't finish uploading. Try again.", "upload_missing");
  if (download.data.size > MAX_DECK_FILE_BYTES) throw new ApiError(413, "That deck is over 50 MB. Export it without media and try again.", "file_too_big");
  const bytes = new Uint8Array(await download.data.arrayBuffer());
  try {
    if (looksLikeZip(bytes)) return await parseApkg(bytes);
    if (/\.(apkg|colpkg)$/i.test(fileName ?? "")) throw new DeckFormatError("That file isn't a real Anki deck.");
    return parseTextExport(new TextDecoder("utf-8").decode(bytes));
  } catch (error) {
    if (error instanceof DeckFormatError) throw new ApiError(422, error.message, "bad_deck");
    console.error("Reading an Anki deck failed", error);
    throw new ApiError(
      422,
      "That deck couldn't be opened here. In Anki, export it as \"Notes in Plain Text\" and add that file instead.",
      "bad_deck",
    );
  }
}

export type ImportInput = { fileName: string | null; storagePath?: string; text?: string };

// Reads the deck, saves its cards with their match vectors, and files each card under its closest stone.
export async function importDeck(ctx: UserContext, input: ImportInput): Promise<DeckView> {
  let parsed: ParsedDeck;
  if (input.storagePath) {
    parsed = await readDeckFile(ctx, input.storagePath, input.fileName);
  } else if (input.text?.trim()) {
    if (input.text.length > MAX_DECK_TEXT_CHARS) throw new ApiError(413, "That text is too long for one deck.", "text_too_long");
    try {
      parsed = parseTextExport(input.text);
    } catch (error) {
      if (error instanceof DeckFormatError) throw new ApiError(422, error.message, "bad_deck");
      throw error;
    }
  } else {
    throw new ApiError(400, "Pick an Anki deck first.", "empty");
  }
  if (parsed.cards.length === 0) throw new ApiError(422, "No cards with a front and a back were found in that deck.", "empty_deck");

  const deck = check(
    await ctx.supabase
      .from("decks")
      .insert({
        user_id: ctx.user.id,
        name: deckNameFrom(parsed, input.fileName),
        file_name: input.fileName?.slice(0, 200) ?? null,
        source_format: input.storagePath && !/\.(txt|tsv|csv)$/i.test(input.fileName ?? "") ? "apkg" : "text",
        storage_path: input.storagePath ?? null,
        skipped_count: parsed.skipped,
      })
      .select("id")
      .single(),
    "create deck",
  ) as { id: string };

  try {
    const vectors = await embed(parsed.cards.map(cardEmbeddingText), "document");
    for (let i = 0; i < parsed.cards.length; i += INSERT_BATCH) {
      const rows = parsed.cards.slice(i, i + INSERT_BATCH).map((card, j) => ({
        user_id: ctx.user.id,
        deck_id: deck.id,
        front: card.front,
        back: card.back,
        tags: card.tags,
        anki_note_id: card.noteId,
        anki_guid: card.guid,
        sort_order: i + j + 1,
        embedding: toPgVector(vectors[i + j]),
      }));
      check(await ctx.supabase.from("deck_cards").insert(rows), "save cards");
    }
    check(await ctx.supabase.rpc("link_deck_cards", { p_deck_id: deck.id, min_similarity: LINK_THRESHOLD }), "file cards");
    check(
      await ctx.supabase
        .from("decks")
        .update({
          state: "ready",
          card_count: parsed.cards.length,
          imported_at: new Date().toISOString(),
          error: parsed.truncated ? `Only the first ${parsed.cards.length} cards were added.` : null,
        })
        .eq("id", deck.id),
      "finish deck",
    );
  } catch (error) {
    await ctx.supabase
      .from("decks")
      .update({ state: "failed", error: error instanceof ApiError ? error.message : "Adding the cards didn't finish." })
      .eq("id", deck.id);
    throw error;
  }
  return deckView(ctx, deck.id);
}

export async function setCheckCap(ctx: UserContext, deckId: string, cap: number): Promise<DeckView> {
  const row = await loadDeckRow(ctx, deckId);
  if (cap < row.checks_used) throw new ApiError(400, `This deck has already used ${row.checks_used} checks.`, "cap_too_low");
  if (cap > MAX_CHECK_CAP) throw new ApiError(400, `A deck can have up to ${MAX_CHECK_CAP} checks.`, "cap_too_high");
  check(await ctx.supabase.from("decks").update({ check_cap: cap }).eq("id", deckId), "save cap");
  return deckView(ctx, deckId);
}

export async function deleteDeck(ctx: UserContext, deckId: string): Promise<void> {
  const row = check(await ctx.supabase.from("decks").select("id, storage_path").eq("id", deckId).maybeSingle(), "load deck") as {
    id: string;
    storage_path: string | null;
  } | null;
  if (!row) throw new ApiError(404, "That deck isn't in your library.", "not_found");
  check(await ctx.supabase.from("decks").delete().eq("id", deckId), "delete deck");
  if (row.storage_path) {
    const { error } = await ctx.supabase.storage.from("uploads").remove([row.storage_path]);
    if (error) console.warn("Could not remove a deck file from storage", error.message);
  }
}

// The deck as an .apkg for Anki: active cards, with accepted corrections and added cards.
export async function exportDeck(ctx: UserContext, deckId: string): Promise<{ fileName: string; bytes: Uint8Array }> {
  const deck = await loadDeckRow(ctx, deckId);
  const cards = check(
    await ctx.supabase.from("deck_cards").select("id, front, back, tags").eq("deck_id", deckId).eq("state", "active").order("sort_order"),
    "load cards",
  ) as { id: string; front: string; back: string; tags: string[] }[];
  if (cards.length === 0) throw new ApiError(409, "This deck has no cards to export.", "empty_deck");
  const name = `${deck.name} (checked)`;
  const bytes = await buildApkg({ id: deck.id, name }, cards);
  const fileName = `${deck.name.replace(/[^\w .-]+/g, "").trim().slice(0, 60) || "deck"} (checked).apkg`;
  return { fileName, bytes };
}

const MAX_STONE_CARDS = 10;

// A stone's cards that are safe to study: checked and cleared, or added from a suggestion.
export async function stoneCards(ctx: UserContext, stoneId: string): Promise<DeckCardView[]> {
  const rows = check(
    await ctx.supabase
      .from("deck_cards")
      .select("id, front, back, origin, card_checks(decision, verdict)")
      .eq("stone_id", stoneId)
      .eq("state", "active")
      .not("checked_at", "is", null)
      .order("created_at")
      .limit(MAX_STONE_CARDS * 3),
    "load stone cards",
  ) as unknown as { id: string; front: string; back: string; origin: "import" | "suggested"; card_checks: { decision: string; verdict: string } | null }[];
  return rows
    .filter((r) => r.origin === "suggested" || (r.card_checks != null && r.card_checks.decision !== "pending" && r.card_checks.verdict !== "no_source"))
    .slice(0, MAX_STONE_CARDS)
    .map((r) => ({ id: r.id, front: r.front, back: r.back, origin: r.origin }));
}
