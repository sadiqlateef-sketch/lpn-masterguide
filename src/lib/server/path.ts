import { mapLimit } from "./http";
import { check, type UserContext } from "./supabase";

const LINK_THRESHOLD = 0.35;

// Cached lessons are rebuilt from their sources; deleting one makes the next open regenerate it.
export async function invalidateLessons(ctx: UserContext, stoneIds: readonly string[]) {
  const ids = [...new Set(stoneIds)];
  if (ids.length === 0) return;
  check(await ctx.supabase.from("lessons").delete().in("stone_id", ids), "invalidate lessons");
}

export type RelinkResult = {
  notesLinked: number;
  stonesWithNewNotes: string[];
  questionsLinked: number;
  missedQuestionIds: string[];
};

// Links notes and questions that arrived before a matching stepping stone existed.
export async function relinkOrphans(ctx: UserContext): Promise<RelinkResult> {
  const notes = check(
    await ctx.supabase.rpc("link_unlinked_note_chunks", { min_similarity: LINK_THRESHOLD }),
    "link notes",
  ) as { stone_id: string; chunk_count: number }[];
  const questions = check(
    await ctx.supabase.rpc("link_unlinked_questions", { min_similarity: LINK_THRESHOLD }),
    "link questions",
  ) as { question_id: string; stone_id: string; user_missed: boolean }[];

  const stonesWithNewNotes = notes.map((n) => n.stone_id);
  await invalidateLessons(ctx, [...stonesWithNewNotes, ...questions.map((q) => q.stone_id)]);

  return {
    notesLinked: notes.reduce((sum, n) => sum + n.chunk_count, 0),
    stonesWithNewNotes,
    questionsLinked: questions.length,
    missedQuestionIds: questions.filter((q) => q.user_missed).map((q) => q.question_id),
  };
}

// Relinks orphans and writes twin practice for any missed question that just found its stone.
export async function relinkAndPractice(
  ctx: UserContext,
  addTwinPractice: (ctx: UserContext, questionId: string) => Promise<number>,
): Promise<RelinkResult & { practiceAdded: number }> {
  const result = await relinkOrphans(ctx);
  const added = await mapLimit(result.missedQuestionIds, 3, async (id) => {
    try {
      return await addTwinPractice(ctx, id);
    } catch (error) {
      // One bad generation shouldn't undo the linking that already succeeded.
      console.error(`Twin practice for question ${id} failed`, error);
      return 0;
    }
  });
  return { ...result, practiceAdded: added.reduce((a, b) => a + b, 0) };
}
