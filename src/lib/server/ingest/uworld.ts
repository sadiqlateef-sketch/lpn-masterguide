import { generateStructured, imageBlocks, type ContentBlock, type ImageInput } from "../anthropic";
import { TwinPracticeSchema, UWorldSchema, type TwinPractice, type UWorldQuestion } from "../ai-schemas";
import { embedOne, toPgVector } from "../embeddings";
import { ApiError } from "../http";
import { BLUEPRINT_GUIDE, LPN_SCOPE_RULES } from "../prompts";
import { check, type UserContext } from "../supabase";
import { invalidateLessons } from "../path";
import { tidyOptionRationales } from "../practice";

const STONE_MATCH_THRESHOLD = 0.35;

const EXTRACT_SYSTEM = `You read a nursing student's own UWorld (or similar) practice question screenshots and pasted rationales, for their private study notes.
Extract the question exactly. Identify which answer the student chose if the screen shows it, and whether they got it wrong.
Write the core takeaway as one plain sentence a beginner can remember. For trap analysis, explain briefly why each wrong choice is tempting but wrong.
Choose the NCLEX-PN client need, HESI domain and NGN clinical judgment step the question mostly tests.

${BLUEPRINT_GUIDE}`;

export async function extractUWorldQuestion(input: { images: readonly ImageInput[]; text: string | null }): Promise<UWorldQuestion> {
  const content: ContentBlock[] = [...imageBlocks(input.images)];
  content.push({
    type: "text",
    text: input.text
      ? `Here is the question and rationale the student pasted:\n\n<pasted>\n${input.text}\n</pasted>`
      : `These ${input.images.length} screenshot(s) show one practice question and its explanation, in order.`,
  });

  const question = await generateStructured({
    what: "uworld-extract",
    schema: UWorldSchema,
    system: EXTRACT_SYSTEM,
    effort: "medium",
    content,
  });

  if (!question.is_question || !question.vignette.trim() || question.choices.length < 2 || question.correct_choice_ids.length === 0) {
    throw new ApiError(422, "That didn't look like a full practice question. Try a screenshot that shows the question and its answer.", "not_a_question");
  }
  return question;
}

const TWIN_SYSTEM = `You write brand-new NCLEX-PN practice items for an LPN/LVN student, based on a concept they just missed.
Never copy the original question's wording, client details or answer choices: write a new client, a new situation and new options that test the same concept.
The twin is a standard multiple-choice item (one correct answer) or select-all-that-apply when the concept suits it.
The bowtie is an NGN mini bowtie: one condition the client is most likely experiencing (choose 1 of 4), two actions to take (choose 2 of 5), and two parameters to monitor (choose 2 of 5).
Give the twin a one-sentence reason for every option, right or wrong.
Every correct answer must be something an LPN/LVN may do. Use option ids "A", "B", "C" and so on.

${LPN_SCOPE_RULES}`;

export async function writeTwinPractice(question: UWorldQuestion): Promise<TwinPractice> {
  const practice = await generateStructured({
    what: "twin-questions",
    schema: TwinPracticeSchema,
    system: TWIN_SYSTEM,
    effort: "high",
    content: `Concept the student missed: ${question.topic}
Core takeaway: ${question.core_takeaway}
Traps they fell for: ${question.trap_analysis.map((t) => t.why_wrong).join(" | ") || "none recorded"}
Clinical judgment step tested: ${question.ngn_step_id}

Write one twin question and one NGN mini bowtie on this concept.`,
  });
  validateTwin(practice);
  return practice;
}

// Structured outputs guarantee shape, not sense; reject items whose answers don't point at real options.
export function validateTwin(practice: TwinPractice) {
  const has = (options: { id: string }[], ids: string[]) => ids.length > 0 && ids.every((id) => options.some((o) => o.id === id));
  const { twin, bowtie } = practice;
  const ok =
    twin.options.length >= 4 &&
    has(twin.options, twin.correct_option_ids) &&
    bowtie.condition.options.length >= 3 &&
    has(bowtie.condition.options, [bowtie.condition.correct_option_id]) &&
    has(bowtie.actions.options, bowtie.actions.correct_option_ids) &&
    has(bowtie.parameters.options, bowtie.parameters.correct_option_ids);
  if (!ok) {
    throw new ApiError(502, "The practice questions came out wrong. Try again.", "bad_twin");
  }
}

type StoredQuestion = { id: string; stone_id: string | null; user_missed: boolean };

// Saves a twin + bowtie for a missed question that is linked to a stone. Skips questions that already have them.
export async function addTwinPractice(ctx: UserContext, questionId: string, question?: UWorldQuestion): Promise<number> {
  const stored = check(
    await ctx.supabase
      .from("uworld_questions")
      .select("id, stone_id, user_missed, topic, core_takeaway, trap_analysis, ngn_step_id")
      .eq("id", questionId)
      .single(),
    "load question",
  ) as StoredQuestion & { topic: string; core_takeaway: string; trap_analysis: UWorldQuestion["trap_analysis"]; ngn_step_id: UWorldQuestion["ngn_step_id"] | null };
  if (!stored.user_missed || !stored.stone_id) return 0;

  const existing = await ctx.supabase
    .from("practice_items")
    .select("id", { count: "exact", head: true })
    .eq("origin_question_id", questionId);
  check(existing, "count practice");
  if ((existing.count ?? 0) > 0) return 0;

  const source: UWorldQuestion =
    question ??
    ({
      topic: stored.topic,
      core_takeaway: stored.core_takeaway,
      trap_analysis: stored.trap_analysis ?? [],
      ngn_step_id: stored.ngn_step_id ?? "recognize_cues",
    } as UWorldQuestion);

  const practice = await writeTwinPractice(source);
  check(
    await ctx.supabase.from("practice_items").insert([
      {
        user_id: ctx.user.id,
        stone_id: stored.stone_id,
        origin_question_id: questionId,
        item_type: practice.twin.correct_option_ids.length > 1 ? "sata" : "twin_mcq",
        ngn_step_id: source.ngn_step_id,
        payload: { ...practice.twin, option_rationales: tidyOptionRationales(practice.twin.option_rationales, practice.twin.options) },
      },
      {
        user_id: ctx.user.id,
        stone_id: stored.stone_id,
        origin_question_id: questionId,
        item_type: "ngn_mini_bowtie",
        ngn_step_id: source.ngn_step_id,
        payload: practice.bowtie,
      },
    ]),
    "save practice",
  );
  return 2;
}

export type UWorldIngestResult = {
  questionId: string;
  topic: string;
  missed: boolean;
  coreTakeaway: string;
  stone: { id: string; title: string } | null;
  practiceAdded: number;
};

export async function ingestUWorld(
  ctx: UserContext,
  input: { images: readonly ImageInput[]; text: string | null; ingestItemId: string },
): Promise<UWorldIngestResult> {
  const question = await extractUWorldQuestion(input);

  const embedding = await embedOne(`${question.topic}\n${question.core_takeaway}\n${question.vignette}`, "query");
  const matches = check(
    await ctx.supabase.rpc("match_stepping_stones", {
      query_embedding: toPgVector(embedding),
      match_count: 1,
      min_similarity: STONE_MATCH_THRESHOLD,
    }),
    "match stone",
  ) as { id: string; title: string }[];
  const stone = matches[0] ? { id: matches[0].id, title: matches[0].title } : null;

  const choiceText = (ids: string[]) => ids.join(", ");
  const inserted = check(
    await ctx.supabase
      .from("uworld_questions")
      .insert({
        user_id: ctx.user.id,
        ingest_item_id: input.ingestItemId,
        stone_id: stone?.id ?? null,
        vignette: question.vignette,
        choices: question.choices,
        correct_answer: choiceText(question.correct_choice_ids),
        user_answer: question.user_answer_visible ? choiceText(question.user_choice_ids) : null,
        core_takeaway: question.core_takeaway,
        trap_analysis: question.trap_analysis,
        user_missed: question.user_missed,
        topic: question.topic,
        client_need_id: question.client_need_id,
        hesi_domain_id: question.hesi_domain_id,
        ngn_step_id: question.ngn_step_id,
        embedding: toPgVector(embedding),
      })
      .select("id")
      .single(),
    "save question",
  ) as { id: string };

  let practiceAdded = 0;
  if (stone) {
    await invalidateLessons(ctx, [stone.id]);
    if (question.user_missed) practiceAdded = await addTwinPractice(ctx, inserted.id, question);
  }

  return {
    questionId: inserted.id,
    topic: question.topic,
    missed: question.user_missed,
    coreTakeaway: question.core_takeaway,
    stone,
    practiceAdded,
  };
}
