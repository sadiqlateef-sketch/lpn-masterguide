import type { AttemptRequest, ExamAnswerResult, ExamState, ExamStopReason, ExamSummary, PracticeView } from "@/lib/api-types";
import { ApiError } from "./http";
import { loadPracticeRow, saveAttempt, toPracticeView } from "./practice";
import { check, type UserContext } from "./supabase";

// Timed adaptive practice exams (F4). Like the NCLEX, each next question is chosen near the
// student's current ability and across the client needs by test-plan weight, and the exam stops
// once the estimate is confidently above or below the passing line, or at the item or time limit.
// Difficulties are rough (by question type and the student's own history), so this is practice,
// never a prediction of the real result, and the screen says so.

export const EXAM_LENGTHS = {
  short: { min: 15, max: 40, minutes: 60 },
  long: { min: 30, max: 85, minutes: 120 },
} as const;
export type ExamLength = keyof typeof EXAM_LENGTHS;

const MIN_POOL = 10;
const PASS_LINE = 0;
const Z95 = 1.96;

// Rough difficulty on a logit scale by question type.
const TYPE_DIFFICULTY: Record<string, number> = { mcq: -0.3, sata: 0.6, bowtie: 0.8, matrix: 0.5, cloze: 0.3, highlight: 0.5, ordered: 0.7 };

export function itemDifficulty(type: PracticeView["type"], history: { missed: number; right: number }): number {
  const base = TYPE_DIFFICULTY[type] ?? 0;
  // A question the student has missed is harder for them; one they've got right is easier.
  return base + (history.missed > 0 ? 0.4 : 0) - (history.right > 0 ? 0.6 : 0);
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

// Expected a posteriori ability on a grid, with a standard normal prior. Partial credit counts as a fraction.
export function estimateAbility(responses: readonly { difficulty: number; score: number }[]): { theta: number; se: number } {
  let sumW = 0;
  let sumT = 0;
  let sumT2 = 0;
  for (let t = -4; t <= 4.0001; t += 0.05) {
    let logL = -0.5 * t * t;
    for (const r of responses) {
      const p = Math.min(Math.max(logistic(t - r.difficulty), 1e-9), 1 - 1e-9);
      logL += r.score * Math.log(p) + (1 - r.score) * Math.log(1 - p);
    }
    const w = Math.exp(logL);
    sumW += w;
    sumT += w * t;
    sumT2 += w * t * t;
  }
  const theta = sumT / sumW;
  const variance = Math.max(sumT2 / sumW - theta * theta, 0);
  return { theta, se: Math.sqrt(variance) };
}

export function stopReason(s: {
  answered: number;
  min: number;
  max: number;
  theta: number;
  se: number;
  elapsedMs: number;
  limitMs: number;
  remaining: number;
}): ExamStopReason | null {
  if (s.elapsedMs >= s.limitMs) return "time";
  if (s.answered >= s.max) return "max_items";
  if (s.remaining <= 0) return "out_of_items";
  if (s.answered >= s.min && s.theta - Z95 * s.se > PASS_LINE) return "confident_above";
  if (s.answered >= s.min && s.theta + Z95 * s.se < PASS_LINE) return "confident_below";
  return null;
}

export type Candidate = { id: string; clientNeed: string | null; difficulty: number };

// The client need furthest behind its test-plan share, then the question closest to the ability estimate.
export function chooseNext(candidates: readonly Candidate[], askedByNeed: Readonly<Record<string, number>>, weights: Readonly<Record<string, number>>, theta: number, rng: () => number = Math.random): Candidate | null {
  if (!candidates.length) return null;
  const asked = Object.values(askedByNeed).reduce((a, b) => a + b, 0);
  const needs = [...new Set(candidates.map((c) => c.clientNeed ?? "none"))];
  const totalWeight = needs.reduce((a, n) => a + (weights[n] ?? 0.05), 0);
  const deficit = (n: string) => ((weights[n] ?? 0.05) / totalWeight) * (asked + 1) - (askedByNeed[n] ?? 0);
  const need = needs.sort((a, b) => deficit(b) - deficit(a) || rng() - 0.5)[0];
  const pool = candidates.filter((c) => (c.clientNeed ?? "none") === need).sort((a, b) => Math.abs(a.difficulty - theta) - Math.abs(b.difficulty - theta));
  // A little randomness among the closest few, so two exams don't run the same.
  return pool[Math.floor(rng() * Math.min(3, pool.length))] ?? pool[0];
}

type SessionRow = {
  id: string;
  min_items: number;
  max_items: number;
  time_limit_minutes: number;
  current_item_id: string | null;
  ability_estimate: number;
  standard_error: number;
  stop_reason: ExamStopReason | null;
  started_at: string;
  finished_at: string | null;
};
type AnswerRow = { practice_item_id: string | null; position: number; client_need_id: string | null; is_correct: boolean; score: number; difficulty: number };
type NeedRow = { client_need_id: string; name: string; min_pct: number; max_pct: number };

const SESSION_COLUMNS = "id, min_items, max_items, time_limit_minutes, current_item_id, ability_estimate, standard_error, stop_reason, started_at, finished_at";

async function clientNeeds(ctx: UserContext): Promise<NeedRow[]> {
  return check(await ctx.supabase.rpc("readiness_by_client_need"), "load client needs") as NeedRow[];
}

// Every question the student has, with its client need and a rough difficulty for them.
async function loadPool(ctx: UserContext): Promise<Candidate[]> {
  const [items, tags, attempts] = await Promise.all([
    ctx.supabase.from("practice_items").select("id, stone_id, client_need_id, item_type, correct:payload->correct_option_ids").limit(2000),
    ctx.supabase.from("stone_blueprint_tags").select("stone_id, client_need_id, relevance"),
    ctx.supabase.from("practice_attempts").select("practice_item_id, is_correct").limit(10000),
  ]);
  const topNeed = new Map<string, { need: string; relevance: number }>();
  for (const t of check(tags, "load tags") as { stone_id: string; client_need_id: string; relevance: number }[]) {
    const seen = topNeed.get(t.stone_id);
    if (!seen || t.relevance > seen.relevance) topNeed.set(t.stone_id, { need: t.client_need_id, relevance: t.relevance });
  }
  const history = new Map<string, { missed: number; right: number }>();
  for (const a of check(attempts, "load attempts") as { practice_item_id: string; is_correct: boolean }[]) {
    const h = history.get(a.practice_item_id) ?? { missed: 0, right: 0 };
    if (a.is_correct) h.right++;
    else h.missed++;
    history.set(a.practice_item_id, h);
  }
  return (check(items, "load questions") as { id: string; stone_id: string | null; client_need_id: string | null; item_type: string; correct: unknown }[]).map((i) => {
    const type: PracticeView["type"] =
      i.item_type === "ngn_mini_bowtie"
        ? "bowtie"
        : i.item_type === "ngn_matrix"
          ? "matrix"
          : i.item_type === "ngn_cloze"
            ? "cloze"
            : i.item_type === "ngn_highlight"
              ? "highlight"
              : i.item_type === "ngn_ordered"
                ? "ordered"
                : Array.isArray(i.correct) && i.correct.length > 1
                  ? "sata"
                  : "mcq";
    return {
      id: i.id,
      clientNeed: i.client_need_id ?? (i.stone_id ? (topNeed.get(i.stone_id)?.need ?? null) : null),
      difficulty: itemDifficulty(type, history.get(i.id) ?? { missed: 0, right: 0 }),
    };
  });
}

function weightsFrom(needs: readonly NeedRow[]): Record<string, number> {
  return Object.fromEntries(needs.map((n) => [n.client_need_id, (Number(n.min_pct) + Number(n.max_pct)) / 200]));
}

export function verdictFor(reason: ExamStopReason | null, theta: number, answered: number): string {
  const caveat = "This is practice built from your own questions, not a prediction of your NCLEX result.";
  if (answered === 0) return `Answer a few questions to see where you stand. ${caveat}`;
  switch (reason) {
    case "confident_above":
      return `You stayed clearly above the passing line this app uses for practice. ${caveat}`;
    case "confident_below":
      return `You stayed below the passing line this app uses for practice. The areas below show where to focus. ${caveat}`;
    default:
      return `${theta >= PASS_LINE ? "You're leaning above" : "You're leaning below"} the passing line, but it isn't settled yet. ${caveat}`;
  }
}

async function summarize(ctx: UserContext, session: SessionRow, answers: readonly AnswerRow[], needs?: NeedRow[]): Promise<ExamSummary> {
  const names = new Map((needs ?? (await clientNeeds(ctx))).map((n) => [n.client_need_id, n.name]));
  const byNeed = new Map<string, { answered: number; correct: number }>();
  for (const a of answers) {
    const key = a.client_need_id ?? "none";
    const b = byNeed.get(key) ?? { answered: 0, correct: 0 };
    b.answered++;
    if (a.is_correct) b.correct++;
    byNeed.set(key, b);
  }
  return {
    id: session.id,
    startedAt: session.started_at,
    finishedAt: session.finished_at,
    minItems: session.min_items,
    maxItems: session.max_items,
    timeLimitMinutes: session.time_limit_minutes,
    answered: answers.length,
    correct: answers.filter((a) => a.is_correct).length,
    ability: Number(Number(session.ability_estimate).toFixed(2)),
    standardError: Number(Number(session.standard_error).toFixed(2)),
    stopReason: session.stop_reason,
    verdict: verdictFor(session.stop_reason, Number(session.ability_estimate), answers.length),
    byClientNeed: [...byNeed.entries()].map(([id, b]) => ({ id, name: names.get(id) ?? "Other", ...b })),
  };
}

async function loadSession(ctx: UserContext, examId: string): Promise<{ session: SessionRow; answers: AnswerRow[] }> {
  const [s, a] = await Promise.all([
    ctx.supabase.from("exam_sessions").select(SESSION_COLUMNS).eq("id", examId).maybeSingle(),
    ctx.supabase.from("exam_answers").select("practice_item_id, position, client_need_id, is_correct, score, difficulty").eq("exam_id", examId).order("position"),
  ]);
  const session = check(s, "load exam") as SessionRow | null;
  if (!session) throw new ApiError(404, "That exam isn't here anymore.", "not_found");
  return { session, answers: check(a, "load exam answers") as AnswerRow[] };
}

async function stateOf(ctx: UserContext, session: SessionRow, answers: readonly AnswerRow[], needs?: NeedRow[]): Promise<ExamState> {
  const summary = await summarize(ctx, session, answers, needs);
  if (session.finished_at || !session.current_item_id) return { summary, current: null };
  const row = await loadPracticeRow(ctx, session.current_item_id);
  return { summary, current: { examId: session.id, position: answers.length + 1, item: toPracticeView(row) } };
}

// Picks the next question (or stops) and saves the session.
async function advance(ctx: UserContext, session: SessionRow, answers: readonly AnswerRow[], needs: NeedRow[]): Promise<SessionRow> {
  const pool = await loadPool(ctx);
  const asked = new Set(answers.map((a) => a.practice_item_id));
  const remaining = pool.filter((c) => !asked.has(c.id));
  const { theta, se } = estimateAbility(answers.map((a) => ({ difficulty: Number(a.difficulty), score: Number(a.score) })));
  const reason = stopReason({
    answered: answers.length,
    min: session.min_items,
    max: session.max_items,
    theta,
    se,
    elapsedMs: Date.now() - new Date(session.started_at).getTime(),
    limitMs: session.time_limit_minutes * 60000,
    remaining: remaining.length,
  });
  const askedByNeed: Record<string, number> = {};
  for (const a of answers) askedByNeed[a.client_need_id ?? "none"] = (askedByNeed[a.client_need_id ?? "none"] ?? 0) + 1;
  const next = reason ? null : chooseNext(remaining, askedByNeed, weightsFrom(needs), theta);
  const patch = {
    ability_estimate: Number(theta.toFixed(4)),
    standard_error: Number(se.toFixed(4)),
    current_item_id: next?.id ?? null,
    stop_reason: reason ?? (next ? null : "out_of_items"),
    finished_at: reason || !next ? new Date().toISOString() : null,
  };
  return check(await ctx.supabase.from("exam_sessions").update(patch).eq("id", session.id).select(SESSION_COLUMNS).single(), "save exam") as SessionRow;
}

export async function startExam(ctx: UserContext, length: ExamLength): Promise<ExamState> {
  const pool = await loadPool(ctx);
  if (pool.length < MIN_POOL) {
    throw new ApiError(409, `A practice exam needs at least ${MIN_POOL} questions to pick from. Open a few more lessons first.`, "too_few_questions");
  }
  const { min, max, minutes } = EXAM_LENGTHS[length];
  const created = check(
    await ctx.supabase
      .from("exam_sessions")
      .insert({ user_id: ctx.user.id, min_items: min, max_items: max, time_limit_minutes: minutes })
      .select(SESSION_COLUMNS)
      .single(),
    "start exam",
  ) as SessionRow;
  const needs = await clientNeeds(ctx);
  const session = await advance(ctx, created, [], needs);
  return stateOf(ctx, session, [], needs);
}

export async function examState(ctx: UserContext, examId: string): Promise<ExamState> {
  const { session, answers } = await loadSession(ctx, examId);
  // An abandoned exam past its time closes when it's next opened.
  if (!session.finished_at && Date.now() - new Date(session.started_at).getTime() >= session.time_limit_minutes * 60000) {
    const needs = await clientNeeds(ctx);
    return stateOf(ctx, await advance(ctx, session, answers, needs), answers, needs);
  }
  return stateOf(ctx, session, answers);
}

export async function answerExam(ctx: UserContext, examId: string, request: AttemptRequest): Promise<ExamAnswerResult> {
  const { session, answers } = await loadSession(ctx, examId);
  if (session.finished_at) throw new ApiError(409, "This exam is over. Start a new one.", "finished");
  if (session.current_item_id !== request.itemId) throw new ApiError(409, "That isn't the current question. Reload the exam.", "wrong_item");

  const row = await loadPracticeRow(ctx, request.itemId);
  const pool = await loadPool(ctx);
  const candidate = pool.find((c) => c.id === row.id);
  const { itemId: _itemId, ...answer } = request;
  const grade = await saveAttempt(ctx, row, answer);
  const saved: AnswerRow = {
    practice_item_id: row.id,
    position: answers.length + 1,
    client_need_id: candidate?.clientNeed ?? null,
    is_correct: grade.correct,
    score: grade.score,
    difficulty: candidate?.difficulty ?? 0,
  };
  const { error } = await ctx.supabase.from("exam_answers").insert({
    ...saved,
    exam_id: examId,
    user_id: ctx.user.id,
    attempt_id: grade.attemptId,
    ability_after: 0,
  });
  if (error?.code === "23505") throw new ApiError(409, "That answer is already saved. Reload the exam.", "duplicate");
  check({ data: null, error }, "save exam answer");

  const all = [...answers, saved];
  const needs = await clientNeeds(ctx);
  const updated = await advance(ctx, session, all, needs);
  await ctx.supabase.from("exam_answers").update({ ability_after: updated.ability_estimate }).eq("exam_id", examId).eq("position", saved.position);
  return { grade, state: await stateOf(ctx, updated, all, needs) };
}

export async function endExam(ctx: UserContext, examId: string): Promise<ExamState> {
  const { session, answers } = await loadSession(ctx, examId);
  if (session.finished_at) return stateOf(ctx, session, answers);
  const updated = check(
    await ctx.supabase
      .from("exam_sessions")
      .update({ stop_reason: "ended", finished_at: new Date().toISOString(), current_item_id: null })
      .eq("id", examId)
      .is("finished_at", null)
      .select(SESSION_COLUMNS)
      .single(),
    "end exam",
  ) as SessionRow;
  return stateOf(ctx, updated, answers);
}

export async function recentExams(ctx: UserContext): Promise<ExamSummary[]> {
  const sessions = check(await ctx.supabase.from("exam_sessions").select(SESSION_COLUMNS).order("started_at", { ascending: false }).limit(10), "load exams") as SessionRow[];
  if (!sessions.length) return [];
  const answers = check(
    await ctx.supabase.from("exam_answers").select("exam_id, practice_item_id, position, client_need_id, is_correct, score, difficulty").in("exam_id", sessions.map((s) => s.id)),
    "load exam answers",
  ) as (AnswerRow & { exam_id: string })[];
  const needs = await clientNeeds(ctx);
  return Promise.all(sessions.map((s) => summarize(ctx, s, answers.filter((a) => a.exam_id === s.id), needs)));
}
