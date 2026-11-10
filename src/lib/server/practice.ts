import type { AttemptRequest, BowtieAnswer, ChoiceView, GradeResult, PracticeView } from "@/lib/api-types";
import type { Bowtie } from "./ai-schemas";
import { ApiError } from "./http";
import { check, type UserContext } from "./supabase";

// Stored payloads. Twin and lesson questions share one shape; bowties have their own.
export type ChoicePayload = {
  stem: string;
  options: ChoiceView[];
  correct_option_ids: string[];
  rationale: string;
  lpn_scope_note?: string;
};

export type PracticeItemType = "twin_mcq" | "sata" | "ngn_mini_bowtie" | "lesson_mcq";

export type PracticeRow = {
  id: string;
  stone_id: string;
  item_type: PracticeItemType;
  origin_question_id: string | null;
  payload: ChoicePayload | Bowtie;
};

type Grade = Omit<GradeResult, "attemptId"> & { selectedIds: string[] };

export function isBowtie(row: Pick<PracticeRow, "item_type">): boolean {
  return row.item_type === "ngn_mini_bowtie";
}

// What the student sees: everything except the answers.
export function toPracticeView(row: PracticeRow): PracticeView {
  const origin = row.origin_question_id ? "uworld_twin" : "lesson";
  if (isBowtie(row)) {
    const b = row.payload as Bowtie;
    return {
      id: row.id,
      type: "bowtie",
      origin,
      scenario: b.scenario,
      condition: { prompt: b.condition.prompt, options: b.condition.options, pick: 1 },
      actions: { prompt: b.actions.prompt, options: b.actions.options, pick: b.actions.correct_option_ids.length },
      parameters: { prompt: b.parameters.prompt, options: b.parameters.options, pick: b.parameters.correct_option_ids.length },
    };
  }
  const p = row.payload as ChoicePayload;
  return { id: row.id, type: p.correct_option_ids.length > 1 ? "sata" : "mcq", origin, stem: p.stem, options: p.options };
}

function uniq(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function requireKnown(ids: readonly string[], options: readonly ChoiceView[]) {
  const unknown = ids.filter((id) => !options.some((o) => o.id === id));
  if (unknown.length) throw new ApiError(400, "That answer doesn't match this question.", "bad_answer");
}

// Single answer: right or wrong. Select-all: right only when the set matches exactly; the score
// gives partial credit (+1 per right pick, -1 per wrong pick, floored at 0), like NGN +/- scoring.
export function gradeChoice(payload: ChoicePayload, selected: readonly string[]): Grade {
  const picks = uniq(selected);
  if (picks.length === 0) throw new ApiError(400, "Pick an answer first.", "no_answer");
  requireKnown(picks, payload.options);
  const correctIds = payload.correct_option_ids;
  const hits = picks.filter((id) => correctIds.includes(id)).length;
  const misses = picks.length - hits;
  const correct = misses === 0 && hits === correctIds.length;
  const score = correctIds.length === 1 ? (correct ? 1 : 0) : Math.max(0, hits - misses) / correctIds.length;
  return {
    correct,
    score,
    rationale: payload.rationale,
    scopeNote: payload.lpn_scope_note?.trim() || null,
    correctOptionIds: correctIds,
    selectedIds: picks,
  };
}

// Bowtie: one point per correct element (1 condition + the actions + the parameters).
export function gradeBowtie(payload: Bowtie, answer: BowtieAnswer): Grade {
  const actions = uniq(answer.actions);
  const parameters = uniq(answer.parameters);
  const condition = answer.condition?.trim() ?? "";
  if (!condition || actions.length !== payload.actions.correct_option_ids.length || parameters.length !== payload.parameters.correct_option_ids.length) {
    throw new ApiError(
      400,
      `Pick 1 condition, ${payload.actions.correct_option_ids.length} actions and ${payload.parameters.correct_option_ids.length} things to monitor.`,
      "incomplete_bowtie",
    );
  }
  requireKnown([condition], payload.condition.options);
  requireKnown(actions, payload.actions.options);
  requireKnown(parameters, payload.parameters.options);

  const total = 1 + payload.actions.correct_option_ids.length + payload.parameters.correct_option_ids.length;
  const points =
    (condition === payload.condition.correct_option_id ? 1 : 0) +
    actions.filter((id) => payload.actions.correct_option_ids.includes(id)).length +
    parameters.filter((id) => payload.parameters.correct_option_ids.includes(id)).length;

  return {
    correct: points === total,
    score: points / total,
    rationale: payload.rationale,
    scopeNote: null,
    bowtie: {
      condition: payload.condition.correct_option_id,
      actions: payload.actions.correct_option_ids,
      parameters: payload.parameters.correct_option_ids,
    },
    selectedIds: [`condition:${condition}`, ...actions.map((id) => `actions:${id}`), ...parameters.map((id) => `parameters:${id}`)],
  };
}

export function grade(row: PracticeRow, request: AttemptRequest): Grade {
  if (isBowtie(row)) {
    if (!request.bowtie) throw new ApiError(400, "Finish all three parts first.", "incomplete_bowtie");
    return gradeBowtie(row.payload as Bowtie, request.bowtie);
  }
  return gradeChoice(row.payload as ChoicePayload, request.selected ?? []);
}

export async function recordAttempt(ctx: UserContext, request: AttemptRequest): Promise<GradeResult> {
  const { data, error } = await ctx.supabase
    .from("practice_items")
    .select("id, stone_id, item_type, origin_question_id, payload")
    .eq("id", request.itemId)
    .maybeSingle();
  check({ data, error }, "load practice item");
  if (!data) throw new ApiError(404, "That question isn't here anymore.", "not_found");

  const { selectedIds, ...result } = grade(data as PracticeRow, request);
  const attempt = check(
    await ctx.supabase
      .from("practice_attempts")
      .insert({ user_id: ctx.user.id, practice_item_id: request.itemId, is_correct: result.correct, selected_option_ids: selectedIds })
      .select("id")
      .single(),
    "save attempt",
  ) as { id: string };
  return { attemptId: attempt.id, ...result };
}
