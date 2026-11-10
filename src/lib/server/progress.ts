import type {
  CompleteResult,
  PathCourse,
  PathView,
  ReadinessCategory,
  ReadinessView,
  StoneStatus,
  TrendWeek,
} from "@/lib/api-types";
import { HESI_MIN_ATTEMPTS, PRACTICE_TARGET } from "@/lib/readiness-rules";
import { ApiError } from "./http";
import type { StoredLesson } from "./lessons";
import { check, type UserContext } from "./supabase";

// ---------------------------------------------------------------------------
// The path map: courses -> books -> units -> modules -> stones, in study order
// ---------------------------------------------------------------------------

type BookRow = {
  id: string;
  title: string;
  edition: string | null;
  cover_url: string | null;
  course_id: string;
  created_at: string;
  units: {
    id: string;
    title: string;
    sort_order: number;
    modules: {
      id: string;
      title: string;
      chapter_number: string | null;
      sort_order: number;
      stepping_stones: { id: string; title: string; summary: string | null; status: StoneStatus; mastery: number; sort_order: number }[];
    }[];
  }[];
};

const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;

export function buildPathView(courses: { id: string; name: string }[], books: BookRow[]): PathView {
  const counts = { stones: 0, ready: 0, mastered: 0, needsReview: 0 };
  let firstReview: string | null = null;
  let firstReady: string | null = null;

  const result: PathCourse[] = courses
    .map((course) => ({
      id: course.id,
      name: course.name,
      books: books
        .filter((b) => b.course_id === course.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((book) => ({
          id: book.id,
          title: book.title,
          edition: book.edition,
          coverUrl: book.cover_url,
          units: [...book.units].sort(bySort).map((unit) => ({
            id: unit.id,
            title: unit.title,
            modules: [...unit.modules].sort(bySort).map((module) => ({
              id: module.id,
              title: module.title,
              chapterNumber: module.chapter_number,
              stones: [...module.stepping_stones].sort(bySort).map((stone) => {
                counts.stones++;
                if (stone.status === "mastered") counts.mastered++;
                if (stone.status === "needs_review") {
                  counts.needsReview++;
                  firstReview ??= stone.id;
                }
                if (stone.status === "ready") {
                  counts.ready++;
                  firstReady ??= stone.id;
                }
                return { id: stone.id, title: stone.title, summary: stone.summary, status: stone.status, mastery: Number(stone.mastery) };
              }),
            })),
          })),
        })),
    }))
    .filter((course) => course.books.length > 0);

  return { courses: result, counts, nextStoneId: firstReview ?? firstReady };
}

export async function loadPath(ctx: UserContext): Promise<PathView> {
  const [courses, books] = await Promise.all([
    ctx.supabase.from("courses").select("id, name").order("sort_order"),
    ctx.supabase
      .from("textbooks")
      .select(
        "id, title, edition, cover_url, course_id, created_at, units(id, title, sort_order, modules(id, title, chapter_number, sort_order, stepping_stones(id, title, summary, status, mastery, sort_order)))",
      ),
  ]);
  return buildPathView(check(courses, "load courses") as { id: string; name: string }[], check(books, "load path") as BookRow[]);
}

// ---------------------------------------------------------------------------
// Finishing a stone after Quick Play
// ---------------------------------------------------------------------------

// Score = share of this lesson's questions whose latest attempt was right.
export function lessonScore(itemIds: readonly string[], attempts: readonly { practice_item_id: string; is_correct: boolean; answered_at: string }[]) {
  const latest = new Map<string, { is_correct: boolean; answered_at: string }>();
  for (const a of attempts) {
    if (!itemIds.includes(a.practice_item_id)) continue;
    const seen = latest.get(a.practice_item_id);
    if (!seen || a.answered_at > seen.answered_at) latest.set(a.practice_item_id, a);
  }
  const answered = latest.size;
  const right = [...latest.values()].filter((a) => a.is_correct).length;
  return { answered, score: itemIds.length ? right / itemIds.length : 0 };
}

export async function completeStone(ctx: UserContext, stoneId: string): Promise<CompleteResult> {
  const lesson = check(await ctx.supabase.from("lessons").select("cards").eq("stone_id", stoneId).maybeSingle(), "load lesson") as {
    cards: StoredLesson;
  } | null;
  if (!lesson) throw new ApiError(409, "Open the lesson first.", "no_lesson");

  const itemIds = lesson.cards.practiceItemIds ?? [];
  const attempts = itemIds.length
    ? (check(
        await ctx.supabase.from("practice_attempts").select("practice_item_id, is_correct, answered_at").in("practice_item_id", itemIds),
        "load attempts",
      ) as { practice_item_id: string; is_correct: boolean; answered_at: string }[])
    : [];
  const { answered, score } = lessonScore(itemIds, attempts);
  if (answered === 0) throw new ApiError(409, "Play the Quick Play questions first.", "not_played");

  const rows = check(await ctx.supabase.rpc("complete_stone", { p_stone_id: stoneId, p_score: Number(score.toFixed(3)) }), "complete stone") as {
    status: StoneStatus;
    unlocked_stone_id: string | null;
  }[];
  const row = rows[0];

  let unlockedStone: CompleteResult["unlockedStone"] = null;
  if (row?.unlocked_stone_id) {
    const next = check(await ctx.supabase.from("stepping_stones").select("id, title").eq("id", row.unlocked_stone_id).single(), "load next stone") as {
      id: string;
      title: string;
    };
    unlockedStone = next;
  }
  return { status: row.status, mastered: row.status === "mastered", score, answered, unlockedStone };
}

// ---------------------------------------------------------------------------
// Readiness: NCLEX-PN readiness % and a HESI score projection
// ---------------------------------------------------------------------------

export { HESI_MIN_ATTEMPTS, PRACTICE_TARGET };
const WEAK_ACCURACY = 0.75;
const WEAK_MIN_ATTEMPTS = 3;

type NeedRow = { client_need_id: string; name: string; min_pct: number; max_pct: number; attempts: number; correct: number };
type Benchmark = { id: string; min_score: number; max_score: number | null; label: string; meaning: string };

// Accuracy pulled toward 50% while there are few answers, so 2 for 2 doesn't read as 100%.
export function smoothedAccuracy(correct: number, attempts: number): number {
  return (correct + 1) / (attempts + 2);
}

// HESI publishes no formula. This is the app's estimate: a weighted accuracy of 70% maps to about 900,
// 80% to about 960, and 60% to about 840, which lines up with the benchmark bands most programs use.
export function projectHesi(weightedAccuracy: number): number {
  return Math.round(Math.min(1200, Math.max(400, 480 + 600 * weightedAccuracy)));
}

export function computeReadiness(
  rows: readonly NeedRow[],
  benchmarks: readonly Benchmark[],
  reviewStones: Map<string, ReadinessCategory["reviewStones"]>,
  path: { stones: number; mastered: number },
  trend: TrendWeek[] = [],
): ReadinessView {
  const categories: ReadinessCategory[] = rows.map((r) => {
    const weightPct = (Number(r.min_pct) + Number(r.max_pct)) / 2;
    const accuracy = r.attempts > 0 ? r.correct / r.attempts : null;
    const coverage = Math.min(1, r.attempts / PRACTICE_TARGET);
    return {
      id: r.client_need_id,
      name: r.name,
      weightPct,
      attempts: r.attempts,
      correct: r.correct,
      accuracy,
      readiness: r.attempts > 0 ? smoothedAccuracy(r.correct, r.attempts) * coverage : 0,
      reviewStones: reviewStones.get(r.client_need_id) ?? [],
    };
  });

  const totalWeight = categories.reduce((s, c) => s + c.weightPct, 0) || 1;
  const nclexReadiness = categories.reduce((s, c) => s + c.weightPct * c.readiness, 0) / totalWeight;
  const totalAttempts = categories.reduce((s, c) => s + c.attempts, 0);

  let hesi: ReadinessView["hesi"] = null;
  const practiced = categories.filter((c) => c.attempts > 0);
  if (totalAttempts >= HESI_MIN_ATTEMPTS && practiced.length) {
    const practicedWeight = practiced.reduce((s, c) => s + c.weightPct, 0);
    const weightedAccuracy = practiced.reduce((s, c) => s + c.weightPct * smoothedAccuracy(c.correct, c.attempts), 0) / practicedWeight;
    const projected = projectHesi(weightedAccuracy);
    const band =
      benchmarks.find((b) => projected >= b.min_score && (b.max_score === null || projected <= b.max_score)) ??
      [...benchmarks].sort((a, b) => a.min_score - b.min_score)[0];
    if (band) hesi = { projected, band: { id: band.id, label: band.label, meaning: band.meaning } };
  }

  // Weak: practiced and below 75%, ranked by how much exam weight is at stake. Then the heaviest untouched areas.
  const weak = categories
    .filter((c) => c.attempts >= WEAK_MIN_ATTEMPTS && (c.accuracy ?? 0) < WEAK_ACCURACY)
    .sort((a, b) => b.weightPct * (1 - (b.accuracy ?? 0)) - a.weightPct * (1 - (a.accuracy ?? 0)));
  const untouched = categories.filter((c) => c.attempts === 0 && c.reviewStones.length > 0).sort((a, b) => b.weightPct - a.weightPct);
  const weakCategoryIds = [...weak, ...untouched].slice(0, 3).map((c) => c.id);

  return {
    nclexReadiness,
    hesi,
    questionsToUnlockHesi: Math.max(0, HESI_MIN_ATTEMPTS - totalAttempts),
    totalAttempts,
    categories,
    weakCategoryIds,
    path,
    trend,
  };
}

// ---------------------------------------------------------------------------
// Trend: share of questions right per week (weeks start Monday, UTC)
// ---------------------------------------------------------------------------

export const TREND_WEEKS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export function weekStartOf(date: Date): Date {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * DAY_MS);
}

export function weeklyTrend(attempts: readonly { is_correct: boolean; answered_at: string }[], now: Date, weeks = TREND_WEEKS): TrendWeek[] {
  const first = weekStartOf(now).getTime() - (weeks - 1) * 7 * DAY_MS;
  const buckets = Array.from({ length: weeks }, (_, i) => ({ start: first + i * 7 * DAY_MS, attempts: 0, correct: 0 }));
  for (const a of attempts) {
    const at = new Date(a.answered_at).getTime();
    if (Number.isNaN(at) || at < first) continue;
    const index = Math.floor((at - first) / (7 * DAY_MS));
    const bucket = buckets[index];
    if (!bucket) continue;
    bucket.attempts++;
    if (a.is_correct) bucket.correct++;
  }
  return buckets.map((b) => ({
    weekStart: new Date(b.start).toISOString().slice(0, 10),
    attempts: b.attempts,
    correct: b.correct,
    accuracy: b.attempts ? b.correct / b.attempts : null,
  }));
}

export function trendSince(now: Date, weeks = TREND_WEEKS): string {
  return new Date(weekStartOf(now).getTime() - (weeks - 1) * 7 * DAY_MS).toISOString();
}

const STATUS_PRIORITY: Record<StoneStatus, number> = { needs_review: 0, ready: 1, mastered: 2, locked: 3 };

export async function loadReadiness(ctx: UserContext, now = new Date()): Promise<ReadinessView> {
  const [needs, benchmarks, tags, stones, recent] = await Promise.all([
    ctx.supabase.rpc("readiness_by_client_need"),
    ctx.supabase.from("hesi_score_benchmarks").select("id, min_score, max_score, label, meaning"),
    ctx.supabase.from("stone_blueprint_tags").select("stone_id, client_need_id, relevance"),
    ctx.supabase.from("stepping_stones").select("id, title, status, mastery"),
    ctx.supabase.from("practice_attempts").select("is_correct, answered_at").gte("answered_at", trendSince(now)),
  ]);

  const stoneRows = check(stones, "load stones") as { id: string; title: string; status: StoneStatus; mastery: number }[];
  const stoneById = new Map(stoneRows.map((s) => [s.id, s]));

  // For each client need: up to 3 open stones to review, needing-review first, then the least mastered.
  const review = new Map<string, ReadinessCategory["reviewStones"]>();
  const grouped = new Map<string, { id: string; title: string; status: StoneStatus; mastery: number }[]>();
  for (const t of check(tags, "load tags") as { stone_id: string; client_need_id: string }[]) {
    const stone = stoneById.get(t.stone_id);
    if (!stone || stone.status === "locked") continue;
    const list = grouped.get(t.client_need_id) ?? [];
    if (!list.some((s) => s.id === stone.id)) list.push(stone);
    grouped.set(t.client_need_id, list);
  }
  for (const [needId, list] of grouped) {
    list.sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || Number(a.mastery) - Number(b.mastery));
    review.set(
      needId,
      list.slice(0, 3).map((s) => ({ id: s.id, title: s.title, status: s.status })),
    );
  }

  return computeReadiness(
    check(needs, "load readiness") as NeedRow[],
    check(benchmarks, "load benchmarks") as Benchmark[],
    review,
    { stones: stoneRows.length, mastered: stoneRows.filter((s) => s.status === "mastered").length },
    weeklyTrend(check(recent, "load recent answers") as { is_correct: boolean; answered_at: string }[], now),
  );
}
