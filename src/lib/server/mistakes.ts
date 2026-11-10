import type { MistakeView } from "@/lib/api-types";
import { GAME_INFO } from "./games/build";
import { loadPracticeRow, loadPracticeRows, toPracticeView } from "./practice";
import { check, type UserContext } from "./supabase";

// The mistake notebook (F10): every question whose latest answer was wrong, with the student's own
// note on why. A question leaves the notebook once it's answered right.

const MAX_NOTE = 1000;

export async function listMistakes(ctx: UserContext): Promise<MistakeView[]> {
  const missed = check(await ctx.supabase.rpc("my_mistakes", { p_limit: 100 }), "load mistakes") as { practice_item_id: string; missed_at: string; misses: number }[];
  if (!missed.length) return [];
  const ids = missed.map((m) => m.practice_item_id);
  const [rows, notes] = await Promise.all([loadPracticeRows(ctx, ids), ctx.supabase.from("mistake_notes").select("practice_item_id, note").in("practice_item_id", ids)]);
  const stoneIds = [...new Set(rows.map((r) => r.stone_id).filter((s): s is string => Boolean(s)))];
  const stones = stoneIds.length
    ? (check(await ctx.supabase.from("stepping_stones").select("id, title").in("id", stoneIds), "load stones") as { id: string; title: string }[])
    : [];
  const noteOf = new Map((check(notes, "load notes") as { practice_item_id: string; note: string }[]).map((n) => [n.practice_item_id, n.note]));
  return rows.map((row) => {
    const m = missed.find((x) => x.practice_item_id === row.id)!;
    const payload = row.payload as { drug?: string; game?: keyof typeof GAME_INFO };
    return {
      item: toPracticeView(row),
      stoneTitle: stones.find((s) => s.id === row.stone_id)?.title ?? null,
      topic: payload.drug ? `Drug card: ${payload.drug}` : payload.game && GAME_INFO[payload.game] ? GAME_INFO[payload.game].title : null,
      missedAt: m.missed_at,
      misses: m.misses,
      note: noteOf.get(row.id) ?? "",
    };
  });
}

export async function saveMistakeNote(ctx: UserContext, itemId: string, note: string): Promise<{ note: string }> {
  await loadPracticeRow(ctx, itemId);
  const text = note.trim().slice(0, MAX_NOTE);
  if (!text) {
    check(await ctx.supabase.from("mistake_notes").delete().eq("practice_item_id", itemId), "clear note");
    return { note: "" };
  }
  check(
    await ctx.supabase
      .from("mistake_notes")
      .upsert({ user_id: ctx.user.id, practice_item_id: itemId, note: text, updated_at: new Date().toISOString() }, { onConflict: "user_id,practice_item_id" }),
    "save note",
  );
  return { note: text };
}
