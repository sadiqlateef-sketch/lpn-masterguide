import type {
  PathView,
  ReviewResult,
  StoneStatus,
  StudyBlockView,
  StudyProfileView,
  TodayView,
  WeeklyReportView,
} from "@/lib/api-types";
import { COURSE_IDS } from "@/lib/blueprint-ids";
import {
  addDays,
  cleanTime,
  type CourseProgress,
  type DueReview,
  furthestBehind,
  gradeFromScore,
  isDay,
  isValidTimeZone,
  localDay,
  nextExam,
  nextReview,
  pace,
  type PlanStone,
  planToday,
  type ReportDay,
  reviewDueOn,
  START_EASE,
  streak,
  weekStart,
  weeklyReport,
} from "@/lib/study-math";
import { courseStats, courseStones } from "@/lib/ui/path-view";
import { ApiError } from "./http";
import type { StoredLesson } from "./lessons";
import { lessonScore, loadPath, loadReadiness } from "./progress";
import { check, type UserContext } from "./supabase";

export const MAX_BLOCKS = 28;
export const MAX_SESSION_MINUTES = 240;
// A review round counts the answers given since it started, allowing for a phone clock a little behind the server's.
const CLOCK_SLACK_MS = 60 * 1000;
const MAX_ROUND_MS = 3 * 60 * 60 * 1000;
const STREAK_LOOKBACK_DAYS = 400;

export const DEFAULT_PROFILE: StudyProfileView = { nclexDate: null, hesiDate: null, reminderTime: null, timezone: "UTC", reviewBufferDays: 14 };

// ---------------------------------------------------------------------------
// Profile: exam dates, reminder time and time zone
// ---------------------------------------------------------------------------

type ProfileRow = { nclex_date: string | null; hesi_date: string | null; reminder_time: string | null; timezone: string; review_buffer_days: number };

export function profileView(row: ProfileRow | null): StudyProfileView {
  if (!row) return { ...DEFAULT_PROFILE };
  return {
    nclexDate: row.nclex_date,
    hesiDate: row.hesi_date,
    reminderTime: cleanTime(row.reminder_time),
    timezone: row.timezone,
    reviewBufferDays: row.review_buffer_days,
  };
}

export type ProfileInput = Partial<StudyProfileView>;

// Checks a profile change against the current profile and returns the full profile to save.
export function mergeProfile(current: StudyProfileView, input: ProfileInput, today: string): StudyProfileView {
  const next = { ...current };
  const examDate = (value: string | null | undefined, name: string): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (!isDay(value)) throw new ApiError(400, `Pick a real ${name} date.`, "bad_date");
    if (value < addDays(today, -366) || value > addDays(today, 3 * 366)) throw new ApiError(400, `That ${name} date looks off. Check the year.`, "bad_date");
    return value;
  };
  const nclex = examDate(input.nclexDate, "NCLEX");
  if (nclex !== undefined) next.nclexDate = nclex;
  const hesi = examDate(input.hesiDate, "HESI");
  if (hesi !== undefined) next.hesiDate = hesi;
  if (input.reminderTime !== undefined) {
    const time = input.reminderTime === null || input.reminderTime === "" ? null : cleanTime(input.reminderTime);
    if (input.reminderTime && !time) throw new ApiError(400, "Pick a reminder time like 19:30.", "bad_time");
    next.reminderTime = time;
  }
  if (input.timezone !== undefined) {
    if (!isValidTimeZone(input.timezone)) throw new ApiError(400, "That time zone isn't one the app knows.", "bad_timezone");
    next.timezone = input.timezone;
  }
  if (input.reviewBufferDays !== undefined) {
    const days = Number(input.reviewBufferDays);
    if (!Number.isInteger(days) || days < 0 || days > 60) throw new ApiError(400, "Keep the review weeks before the exam between 0 and 60 days.", "bad_buffer");
    next.reviewBufferDays = days;
  }
  return next;
}

async function readProfile(ctx: UserContext): Promise<{ profile: StudyProfileView; saved: boolean }> {
  const row = check(
    await ctx.supabase.from("study_profiles").select("nclex_date, hesi_date, reminder_time, timezone, review_buffer_days").maybeSingle(),
    "load study profile",
  ) as ProfileRow | null;
  return { profile: profileView(row), saved: row !== null };
}

export async function getProfile(ctx: UserContext): Promise<StudyProfileView> {
  return (await readProfile(ctx)).profile;
}

export async function saveProfile(ctx: UserContext, input: ProfileInput, now = new Date()): Promise<StudyProfileView> {
  const { profile } = await readProfile(ctx);
  const next = mergeProfile(profile, input, localDay(now, input.timezone && isValidTimeZone(input.timezone) ? input.timezone : profile.timezone));
  check(
    await ctx.supabase.from("study_profiles").upsert({
      user_id: ctx.user.id,
      nclex_date: next.nclexDate,
      hesi_date: next.hesiDate,
      reminder_time: next.reminderTime,
      timezone: next.timezone,
      review_buffer_days: next.reviewBufferDays,
    }),
    "save study profile",
  );
  return next;
}

// ---------------------------------------------------------------------------
// Weekly study blocks
// ---------------------------------------------------------------------------

type BlockRow = { id: string; weekday: number; start_time: string; minutes: number; course_id: string | null };

export function blockView(row: BlockRow): StudyBlockView {
  return { id: row.id, weekday: row.weekday, start: cleanTime(row.start_time) ?? "00:00", minutes: row.minutes, courseId: row.course_id };
}

// Checks the whole week of blocks and returns them sorted by day and time.
export function cleanBlocks(blocks: readonly StudyBlockView[]): StudyBlockView[] {
  if (blocks.length > MAX_BLOCKS) throw new ApiError(400, `Keep it to ${MAX_BLOCKS} study times a week.`, "too_many_blocks");
  const clean = blocks.map((b) => {
    const start = cleanTime(b.start);
    if (!Number.isInteger(b.weekday) || b.weekday < 1 || b.weekday > 7) throw new ApiError(400, "Pick a day of the week for each study time.", "bad_block");
    if (!start) throw new ApiError(400, "Pick a start time like 19:30 for each study time.", "bad_block");
    if (!Number.isInteger(b.minutes) || b.minutes < 10 || b.minutes > 480) throw new ApiError(400, "Each study time runs 10 minutes to 8 hours.", "bad_block");
    if (b.courseId !== null && !(COURSE_IDS as readonly string[]).includes(b.courseId)) throw new ApiError(400, "Pick one of your courses for each study time.", "bad_block");
    return { weekday: b.weekday, start, minutes: b.minutes, courseId: b.courseId };
  });
  clean.sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  // Two blocks on the same day can't overlap.
  for (let i = 1; i < clean.length; i++) {
    const [prev, cur] = [clean[i - 1], clean[i]];
    if (prev.weekday !== cur.weekday) continue;
    const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    if (toMinutes(prev.start) + prev.minutes > toMinutes(cur.start)) throw new ApiError(400, "Two study times on the same day overlap.", "overlap");
  }
  return clean;
}

export async function getBlocks(ctx: UserContext): Promise<StudyBlockView[]> {
  const rows = check(
    await ctx.supabase.from("study_blocks").select("id, weekday, start_time, minutes, course_id").order("weekday").order("start_time"),
    "load study times",
  ) as BlockRow[];
  return rows.map(blockView);
}

// Replaces the whole week.
export async function saveBlocks(ctx: UserContext, blocks: readonly StudyBlockView[]): Promise<StudyBlockView[]> {
  const clean = cleanBlocks(blocks);
  check(await ctx.supabase.from("study_blocks").delete().eq("user_id", ctx.user.id), "clear study times");
  if (clean.length) {
    check(
      await ctx.supabase
        .from("study_blocks")
        .insert(clean.map((b) => ({ user_id: ctx.user.id, weekday: b.weekday, start_time: b.start, minutes: b.minutes, course_id: b.courseId }))),
      "save study times",
    );
  }
  return getBlocks(ctx);
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

export function pathProgress(path: PathView): { courses: CourseProgress[]; stones: PlanStone[]; courseOf: Map<string, string> } {
  const courses: CourseProgress[] = [];
  const stones: PlanStone[] = [];
  const courseOf = new Map<string, string>();
  let order = 0;
  for (const course of path.courses) {
    const stats = courseStats(course);
    courses.push({ id: course.id, name: course.name, total: stats.total, mastered: stats.mastered });
    for (const stone of courseStones(course)) {
      courseOf.set(stone.id, course.id);
      stones.push({ id: stone.id, title: stone.title, courseId: course.id, status: stone.status, order: order++ });
    }
  }
  return { courses, stones, courseOf };
}

type DayRow = { day: string; minutes: number; stones_done: number; questions_answered: number; reviews_done: number };
type DueRow = { stone_id: string; due_on: string; stepping_stones: { title: string; status: StoneStatus } | null };

// `deviceTimeZone` is used, and saved, only while the student has no planner profile yet.
export async function loadToday(ctx: UserContext, deviceTimeZone: string | null, now = new Date()): Promise<TodayView> {
  let { profile, saved } = await readProfile(ctx);
  if (!saved && deviceTimeZone && isValidTimeZone(deviceTimeZone) && deviceTimeZone !== profile.timezone) {
    profile = await saveProfile(ctx, { timezone: deviceTimeZone }, now);
  }
  const today = localDay(now, profile.timezone);

  const [path, blocks, due, days] = await Promise.all([
    loadPath(ctx, now),
    getBlocks(ctx),
    ctx.supabase.from("stone_reviews").select("stone_id, due_on, stepping_stones(title, status)").lte("due_on", today).order("due_on"),
    ctx.supabase.from("study_days").select("day, minutes, stones_done, questions_answered, reviews_done").gte("day", addDays(today, -STREAK_LOOKBACK_DAYS)),
  ]);

  const { courses, stones, courseOf } = pathProgress(path);
  const dueReviews: DueReview[] = (check(due, "load due reviews") as unknown as DueRow[]).flatMap((r) =>
    r.stepping_stones?.status === "mastered" && courseOf.has(r.stone_id)
      ? [{ id: r.stone_id, title: r.stepping_stones.title, courseId: courseOf.get(r.stone_id)!, status: "mastered" as const, dueOn: r.due_on }]
      : [],
  );
  const dayRows = check(days, "load study days") as DayRow[];
  const todayRow = dayRows.find((d) => d.day === today);
  const active = dayRows.filter((d) => d.minutes > 0 || d.stones_done > 0 || d.questions_answered > 0 || d.reviews_done > 0).map((d) => d.day);

  const paceView = pace({
    today,
    nclexDate: profile.nclexDate,
    hesiDate: profile.hesiDate,
    bufferDays: profile.reviewBufferDays,
    remainingStones: stones.filter((s) => s.status !== "mastered").length,
    blocks,
  });

  return {
    ...planToday({ today, blocks, courses, stones, dueReviews, pace: paceView }),
    done: {
      minutes: todayRow?.minutes ?? 0,
      stones: todayRow?.stones_done ?? 0,
      questions: todayRow?.questions_answered ?? 0,
      reviews: todayRow?.reviews_done ?? 0,
    },
    streak: streak(active, today),
    pace: paceView,
    reminderTime: profile.reminderTime,
    hasSetup: blocks.length > 0 || profile.nclexDate !== null || profile.hesiDate !== null,
  };
}

// Minutes spent in a lesson or a round, added to today.
export async function logMinutes(ctx: UserContext, minutes: number): Promise<{ minutes: number }> {
  const clean = Math.round(minutes);
  if (!Number.isFinite(clean) || clean < 1 || clean > MAX_SESSION_MINUTES) throw new ApiError(400, "That study time doesn't look right.", "bad_minutes");
  check(await ctx.supabase.rpc("bump_study_day", { p_minutes: clean }), "log study time");
  return { minutes: clean };
}

// ---------------------------------------------------------------------------
// Spaced review: grading a round of a mastered stone's questions
// ---------------------------------------------------------------------------

type ReviewRow = { interval_days: number; ease: number; reps: number; lapses: number; last_reviewed_at: string | null };

export async function recordReview(ctx: UserContext, stoneId: string, startedAt: Date, now = new Date()): Promise<ReviewResult> {
  const started = startedAt.getTime();
  if (Number.isNaN(started) || started > now.getTime() + CLOCK_SLACK_MS || now.getTime() - started > MAX_ROUND_MS) {
    throw new ApiError(400, "That review round is too old. Start it again.", "bad_round");
  }

  const stone = check(await ctx.supabase.from("stepping_stones").select("id, status").eq("id", stoneId).maybeSingle(), "find stone") as {
    id: string;
    status: StoneStatus;
  } | null;
  if (!stone) throw new ApiError(404, "That stone isn't on your path anymore.", "not_found");
  if (stone.status === "needs_review") throw new ApiError(409, "This one slipped. Open its lesson to learn it again.", "needs_relearn");
  if (stone.status !== "mastered") throw new ApiError(409, "Reviews start once you master this stone.", "not_mastered");

  const lesson = check(await ctx.supabase.from("lessons").select("cards").eq("stone_id", stoneId).maybeSingle(), "load lesson") as {
    cards: StoredLesson;
  } | null;
  const itemIds = lesson?.cards.practiceItemIds ?? [];
  if (!itemIds.length) throw new ApiError(409, "Open the lesson first.", "no_lesson");

  const since = new Date(started - CLOCK_SLACK_MS).toISOString();
  const [attempts, existing, profile] = await Promise.all([
    ctx.supabase.from("practice_attempts").select("practice_item_id, is_correct, answered_at").in("practice_item_id", itemIds).gte("answered_at", since),
    ctx.supabase.from("stone_reviews").select("interval_days, ease, reps, lapses, last_reviewed_at").eq("stone_id", stoneId).maybeSingle(),
    readProfile(ctx),
  ]);
  const rows = check(attempts, "load review answers") as { practice_item_id: string; is_correct: boolean; answered_at: string }[];
  const { answered, score } = lessonScore(itemIds, rows);
  if (answered === 0) throw new ApiError(409, "Answer the review questions first.", "not_played");
  const correct = Math.round(score * itemIds.length);

  const prevRow = check(existing, "load review") as ReviewRow | null;
  if (prevRow?.last_reviewed_at && Date.parse(prevRow.last_reviewed_at) >= started - CLOCK_SLACK_MS) {
    throw new ApiError(409, "This review is already saved.", "already_saved");
  }
  const prev = prevRow
    ? { intervalDays: prevRow.interval_days, ease: Number(prevRow.ease), reps: prevRow.reps, lapses: prevRow.lapses }
    : { intervalDays: 1, ease: START_EASE, reps: 1, lapses: 0 };

  const grade = gradeFromScore(correct, answered);
  const next = nextReview(prev, grade);
  const today = localDay(now, profile.profile.timezone);
  const dueOn = reviewDueOn(today, next.intervalDays, nextExam(today, profile.profile.nclexDate, profile.profile.hesiDate)?.date ?? null);

  check(
    await ctx.supabase.from("stone_reviews").upsert({
      stone_id: stoneId,
      user_id: ctx.user.id,
      interval_days: next.intervalDays,
      ease: next.ease,
      reps: next.reps,
      lapses: next.lapses,
      due_on: dueOn,
      last_reviewed_at: now.toISOString(),
    }),
    "save review",
  );
  check(
    await ctx.supabase
      .from("review_log")
      .insert({ user_id: ctx.user.id, stone_id: stoneId, grade, answered, correct, interval_days: next.intervalDays }),
    "log review",
  );
  let status: StoneStatus = "mastered";
  if (grade === "again") {
    check(await ctx.supabase.from("stepping_stones").update({ status: "needs_review" }).eq("id", stoneId), "flag slipped stone");
    status = "needs_review";
  }
  check(await ctx.supabase.rpc("bump_study_day", { p_reviews: 1 }), "count review");

  return { grade, correct, answered, intervalDays: next.intervalDays, dueOn, status };
}

// ---------------------------------------------------------------------------
// Weekly report: last week (saved once it's over) and this week so far
// ---------------------------------------------------------------------------

type StoneRef = { stone_id: string; created_at?: string; reviewed_at?: string; stepping_stones: { title: string } | null };

function answersBetween(rows: readonly { is_correct: boolean; answered_at: string }[], timeZone: string, from: string, to: string) {
  const inRange = rows.filter((r) => {
    const day = localDay(new Date(r.answered_at), timeZone);
    return day >= from && day <= to;
  });
  return { correct: inRange.filter((r) => r.is_correct).length, total: inRange.length };
}

function refsBetween(rows: readonly StoneRef[], timeZone: string, from: string, to: string, at: (r: StoneRef) => string | undefined) {
  const seen = new Map<string, { id: string; title: string }>();
  for (const r of rows) {
    const when = at(r);
    if (!when || !r.stepping_stones) continue;
    const day = localDay(new Date(when), timeZone);
    if (day >= from && day <= to) seen.set(r.stone_id, { id: r.stone_id, title: r.stepping_stones.title });
  }
  return [...seen.values()];
}

export async function loadWeeklyReports(ctx: UserContext, now = new Date()): Promise<{ lastWeek: WeeklyReportView; thisWeek: WeeklyReportView }> {
  const { profile } = await readProfile(ctx);
  const tz = profile.timezone;
  const today = localDay(now, tz);
  const thisStart = weekStart(today);
  const lastStart = addDays(thisStart, -7);
  const twoBack = addDays(thisStart, -14);

  const saved = check(
    await ctx.supabase.from("weekly_reports").select("payload").eq("week_start", lastStart).maybeSingle(),
    "load weekly report",
  ) as { payload: WeeklyReportView } | null;

  // A day of slack on each side covers every time zone; answers are then bucketed by the student's own day.
  const sinceIso = `${addDays(twoBack, -1)}T00:00:00Z`;
  const [blocks, days, answers, mastered, slipped, path, readiness] = await Promise.all([
    getBlocks(ctx),
    ctx.supabase.from("study_days").select("day, minutes, stones_done, questions_answered, reviews_done").gte("day", lastStart),
    ctx.supabase.from("practice_attempts").select("is_correct, answered_at").gte("answered_at", sinceIso),
    ctx.supabase.from("stone_reviews").select("stone_id, created_at, stepping_stones(title)").gte("created_at", sinceIso),
    ctx.supabase.from("review_log").select("stone_id, reviewed_at, stepping_stones(title)").eq("grade", "again").gte("reviewed_at", sinceIso),
    loadPath(ctx, now),
    loadReadiness(ctx, now),
  ]);

  const dayRows: ReportDay[] = (check(days, "load study days") as DayRow[]).map((d) => ({
    day: d.day,
    minutes: d.minutes,
    stones: d.stones_done,
    questions: d.questions_answered,
    reviews: d.reviews_done,
  }));
  const answerRows = check(answers, "load answers") as { is_correct: boolean; answered_at: string }[];
  const masteredRows = check(mastered, "load mastered stones") as unknown as StoneRef[];
  const slippedRows = check(slipped, "load slipped stones") as unknown as StoneRef[];
  const weakAreas = readiness.weakCategoryIds.map((id) => readiness.categories.find((c) => c.id === id)?.name).filter((n): n is string => !!n);
  const behind = furthestBehind(pathProgress(path).courses)?.name ?? null;

  const build = (start: string): WeeklyReportView => {
    const end = addDays(start, 6);
    return weeklyReport({
      weekStart: start,
      today,
      days: dayRows,
      blocks,
      answers: { thisWeek: answersBetween(answerRows, tz, start, end), lastWeek: answersBetween(answerRows, tz, addDays(start, -7), addDays(start, -1)) },
      mastered: refsBetween(masteredRows, tz, start, end, (r) => r.created_at),
      slipped: refsBetween(slippedRows, tz, start, end, (r) => r.reviewed_at),
      weakAreas,
      behindCourse: behind,
    });
  };

  let lastWeek = saved?.payload ?? null;
  if (!lastWeek) {
    lastWeek = build(lastStart);
    // Saved once, so the report keeps saying what it said even as stones change later. A race to save it is harmless.
    const insert = await ctx.supabase.from("weekly_reports").insert({ user_id: ctx.user.id, week_start: lastStart, payload: lastWeek });
    if (insert.error && (insert.error as { code?: string }).code !== "23505") check(insert, "save weekly report");
  }
  return { lastWeek, thisWeek: build(thisStart) };
}
