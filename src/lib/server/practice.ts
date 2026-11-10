import type { AttemptRequest, BowtieAnswer, ChoiceView, GradeResult, OptionRationale, PracticeView } from "@/lib/api-types";
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
  option_rationales?: OptionRationale[];
};

export type MatrixPayload = {
  stem: string;
  columns: ChoiceView[];
  rows: ChoiceView[];
  answers: { row: string; column: string }[];
  rationale: string;
};

export type ClozePayload = {
  stem: string;
  text: string;
  blanks: { id: string; options: ChoiceView[]; correct_option_id: string }[];
  rationale: string;
};

export type HighlightPayload = { stem: string; segments: ChoiceView[]; correct_ids: string[]; rationale: string };

export type OrderedPayload = { stem: string; items: ChoiceView[]; correct_order: string[]; rationale: string };

export const NGN_ITEM_TYPES = ["ngn_matrix", "ngn_cloze", "ngn_highlight", "ngn_ordered"] as const;
export type NgnItemType = (typeof NGN_ITEM_TYPES)[number];

export type PracticeItemType = "twin_mcq" | "sata" | "ngn_mini_bowtie" | "lesson_mcq" | "drug_mcq" | "round_mcq" | "skill_mcq" | "clinical_mcq" | NgnItemType;

export type PracticePayload = ChoicePayload | Bowtie | MatrixPayload | ClozePayload | HighlightPayload | OrderedPayload;

export type PracticeRow = {
  id: string;
  stone_id: string | null;
  item_type: PracticeItemType;
  origin_question_id: string | null;
  payload: PracticePayload;
};

export const PRACTICE_COLUMNS = "id, stone_id, item_type, origin_question_id, payload";

type Grade = Omit<GradeResult, "attemptId"> & { selectedIds: string[] };

export function isBowtie(row: Pick<PracticeRow, "item_type">): boolean {
  return row.item_type === "ngn_mini_bowtie";
}

// What the student sees: everything except the answers.
export function toPracticeView(row: PracticeRow): PracticeView {
  const origin = row.origin_question_id ? "uworld_twin" : "lesson";
  switch (row.item_type) {
    case "ngn_mini_bowtie": {
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
    case "ngn_matrix": {
      const m = row.payload as MatrixPayload;
      return { id: row.id, type: "matrix", origin, stem: m.stem, columns: m.columns, rows: m.rows };
    }
    case "ngn_cloze": {
      const c = row.payload as ClozePayload;
      return { id: row.id, type: "cloze", origin, stem: c.stem, text: c.text, blanks: c.blanks.map((b) => ({ id: b.id, options: b.options })) };
    }
    case "ngn_highlight": {
      const h = row.payload as HighlightPayload;
      return { id: row.id, type: "highlight", origin, stem: h.stem, segments: h.segments };
    }
    case "ngn_ordered": {
      const o = row.payload as OrderedPayload;
      return { id: row.id, type: "ordered", origin, stem: o.stem, items: shuffledAway(o.items, o.correct_order, row.id) };
    }
    default: {
      const p = row.payload as ChoicePayload;
      return { id: row.id, type: p.correct_option_ids.length > 1 ? "sata" : "mcq", origin, stem: p.stem, options: p.options };
    }
  }
}

// A stable shuffle (same order every time this item is shown) that never shows the answer order.
export function shuffledAway<T extends { id: string }>(items: readonly T[], correct: readonly string[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rand = () => {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return h / 4294967296;
  };
  const out = [...items];
  for (let attempt = 0; attempt < 5; attempt++) {
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    if (out.length < 2 || out.some((it, i) => it.id !== correct[i])) return out;
  }
  return [...out.slice(1), out[0]];
}

// Keeps one short reason per real option, in option order.
export function tidyOptionRationales(raw: readonly { option_id: string; why: string }[] | undefined, options: readonly ChoiceView[]): OptionRationale[] {
  const out: OptionRationale[] = [];
  for (const option of options) {
    const why = raw?.find((r) => r.option_id.trim() === option.id)?.why.replace(/\s+/g, " ").trim().slice(0, 300);
    if (why) out.push({ id: option.id, why });
  }
  return out;
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
    optionRationales: payload.option_rationales?.length ? payload.option_rationales : undefined,
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

// Matrix: one point per row (NGN 0/1 scoring per row).
export function gradeMatrix(payload: MatrixPayload, answer: Record<string, string> | undefined): Grade {
  const picks = answer ?? {};
  const missing = payload.rows.filter((r) => !picks[r.id]);
  if (missing.length) throw new ApiError(400, "Pick an answer in every row.", "incomplete_matrix");
  for (const r of payload.rows) requireKnown([picks[r.id]], payload.columns);
  const key = Object.fromEntries(payload.answers.map((a) => [a.row, a.column]));
  const right = payload.rows.filter((r) => key[r.id] === picks[r.id]).length;
  return {
    correct: right === payload.rows.length,
    score: right / payload.rows.length,
    rationale: payload.rationale,
    scopeNote: null,
    matrix: key,
    selectedIds: payload.rows.map((r) => `${r.id}:${picks[r.id]}`),
  };
}

// Cloze: one point per blank.
export function gradeCloze(payload: ClozePayload, answer: Record<string, string> | undefined): Grade {
  const picks = answer ?? {};
  if (payload.blanks.some((b) => !picks[b.id])) throw new ApiError(400, "Fill in every blank.", "incomplete_cloze");
  for (const b of payload.blanks) requireKnown([picks[b.id]], b.options);
  const key = Object.fromEntries(payload.blanks.map((b) => [b.id, b.correct_option_id]));
  const right = payload.blanks.filter((b) => key[b.id] === picks[b.id]).length;
  return {
    correct: right === payload.blanks.length,
    score: right / payload.blanks.length,
    rationale: payload.rationale,
    scopeNote: null,
    cloze: key,
    selectedIds: payload.blanks.map((b) => `${b.id}:${picks[b.id]}`),
  };
}

// Highlight: scored like select-all (+/- partial credit).
export function gradeHighlight(payload: HighlightPayload, selected: readonly string[]): Grade {
  return gradeChoice({ stem: payload.stem, options: payload.segments, correct_option_ids: payload.correct_ids, rationale: payload.rationale }, selected);
}

// Ordered response: right only when every step is in place (NGN 0/1).
export function gradeOrdered(payload: OrderedPayload, order: readonly string[] | undefined): Grade {
  const given = (order ?? []).map((id) => id.trim());
  const ids = payload.items.map((i) => i.id);
  if (given.length !== ids.length || new Set(given).size !== ids.length || given.some((id) => !ids.includes(id))) {
    throw new ApiError(400, "Put every step in order first.", "incomplete_order");
  }
  const correct = given.every((id, i) => id === payload.correct_order[i]);
  return {
    correct,
    score: correct ? 1 : 0,
    rationale: payload.rationale,
    scopeNote: null,
    order: payload.correct_order,
    selectedIds: given.map((id, i) => `${i + 1}:${id}`),
  };
}

export function grade(row: PracticeRow, request: Omit<AttemptRequest, "itemId">): Grade {
  switch (row.item_type) {
    case "ngn_mini_bowtie":
      if (!request.bowtie) throw new ApiError(400, "Finish all three parts first.", "incomplete_bowtie");
      return gradeBowtie(row.payload as Bowtie, request.bowtie);
    case "ngn_matrix":
      return gradeMatrix(row.payload as MatrixPayload, request.matrix);
    case "ngn_cloze":
      return gradeCloze(row.payload as ClozePayload, request.cloze);
    case "ngn_highlight":
      return gradeHighlight(row.payload as HighlightPayload, request.selected ?? []);
    case "ngn_ordered":
      return gradeOrdered(row.payload as OrderedPayload, request.order);
    default:
      return gradeChoice(row.payload as ChoicePayload, request.selected ?? []);
  }
}

export async function loadPracticeRow(ctx: UserContext, itemId: string): Promise<PracticeRow> {
  const { data, error } = await ctx.supabase.from("practice_items").select(PRACTICE_COLUMNS).eq("id", itemId).maybeSingle();
  check({ data, error }, "load practice item");
  if (!data) throw new ApiError(404, "That question isn't here anymore.", "not_found");
  return data as PracticeRow;
}

export async function loadPracticeRows(ctx: UserContext, ids: readonly string[]): Promise<PracticeRow[]> {
  if (!ids.length) return [];
  const rows = check(await ctx.supabase.from("practice_items").select(PRACTICE_COLUMNS).in("id", [...ids]), "load practice") as PracticeRow[];
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is PracticeRow => Boolean(r));
}

// Grades and saves one answer. Exams pass the row they already loaded.
export async function saveAttempt(ctx: UserContext, row: PracticeRow, request: Omit<AttemptRequest, "itemId">): Promise<GradeResult> {
  const { selectedIds, ...result } = grade(row, request);
  const attempt = check(
    await ctx.supabase
      .from("practice_attempts")
      .insert({ user_id: ctx.user.id, practice_item_id: row.id, is_correct: result.correct, selected_option_ids: selectedIds })
      .select("id")
      .single(),
    "save attempt",
  ) as { id: string };
  return { attemptId: attempt.id, ...result };
}

export async function recordAttempt(ctx: UserContext, request: AttemptRequest): Promise<GradeResult> {
  const { itemId, ...answer } = request;
  return saveAttempt(ctx, await loadPracticeRow(ctx, itemId), answer);
}
