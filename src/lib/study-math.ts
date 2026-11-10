// The planner's arithmetic: calendar days in the student's time zone, spaced review intervals,
// pacing toward the exam, today's plan, streaks and the weekly report. No I/O, shared by server and screens.

import type {
  PaceView,
  ReviewGrade,
  StreakView,
  StudyBlockView,
  TodayStone,
  TodayView,
  WeeklyReportView,
} from "@/lib/api-types";

// Rough minutes per kind of work, used to size the day.
export const STONE_MINUTES = 20;
export const REVIEW_MINUTES = 5;
export const QUESTION_MINUTES = 1.5;
// When no study times are saved yet, a day is planned as this long.
export const DEFAULT_DAY_MINUTES = 45;
// Reviews take at most this share of a day, so new stones keep moving.
export const REVIEW_SHARE = 0.4;
export const MAX_INTERVAL_DAYS = 180;
export const MIN_EASE = 1.3;
export const MAX_EASE = 3.5;
export const START_EASE = 2.5;

// ---------------------------------------------------------------------------
// Calendar days. A day is "YYYY-MM-DD"; arithmetic is done at UTC noon so daylight saving never shifts it.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayToTime(day: string): number {
  if (!ISO_DAY.test(day)) throw new Error(`Not a day: ${day}`);
  return Date.parse(`${day}T12:00:00Z`);
}

// A real calendar day written as "YYYY-MM-DD" (so not "2026-02-30").
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return false;
  const time = Date.parse(`${value}T12:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
}

export function addDays(day: string, n: number): string {
  return new Date(dayToTime(day) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((dayToTime(to) - dayToTime(from)) / DAY_MS);
}

// ISO weekday: 1 is Monday, 7 is Sunday.
export function isoWeekday(day: string): number {
  const d = new Date(dayToTime(day)).getUTCDay();
  return d === 0 ? 7 : d;
}

export function weekStart(day: string): string {
  return addDays(day, 1 - isoWeekday(day));
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// The calendar day it is for the student at `at`, in their time zone.
export function localDay(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: isValidTimeZone(timeZone) ? timeZone : "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// "HH:MM" from "HH:MM" or "HH:MM:SS"; null for anything else.
export function cleanTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

// ---------------------------------------------------------------------------
// Spaced review (SM-2 style)
// ---------------------------------------------------------------------------

export type ReviewState = { intervalDays: number; ease: number; reps: number; lapses: number };

// How a review round went: all right is easy, a miss or two is good or hard, under 60% is a miss.
export function gradeFromScore(correct: number, answered: number): ReviewGrade {
  if (answered <= 0) return "again";
  const share = correct / answered;
  if (share >= 1) return "easy";
  if (share >= 0.8) return "good";
  if (share >= 0.6) return "hard";
  return "again";
}

const QUALITY: Record<ReviewGrade, number> = { again: 1, hard: 3, good: 4, easy: 5 };

export function nextReview(prev: ReviewState, grade: ReviewGrade): ReviewState {
  const q = QUALITY[grade];
  const ease = Math.min(MAX_EASE, Math.max(MIN_EASE, prev.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))));
  const round = (n: number) => Math.round(n * 100) / 100;
  if (grade === "again") {
    return { intervalDays: 1, ease: round(Math.max(MIN_EASE, prev.ease - 0.2)), reps: 0, lapses: prev.lapses + 1 };
  }
  const reps = prev.reps + 1;
  let interval: number;
  if (reps <= 1) interval = 1;
  else if (reps === 2) interval = grade === "hard" ? 3 : 6;
  else interval = Math.round(prev.intervalDays * (grade === "hard" ? 1.2 : ease));
  if (grade === "easy") interval = Math.round(interval * 1.3);
  // Once a stone is well along, a good review always pushes it further out than last time.
  if (reps >= 3 && grade !== "hard") interval = Math.max(interval, prev.intervalDays + 1);
  interval = Math.min(MAX_INTERVAL_DAYS, Math.max(1, interval));
  return { intervalDays: interval, ease: round(ease), reps, lapses: prev.lapses };
}

// The day a review falls due. A review that would land on or after the exam moves to the day before it.
export function reviewDueOn(today: string, intervalDays: number, examDate: string | null): string {
  const due = addDays(today, intervalDays);
  if (examDate && daysBetween(today, examDate) >= 2 && daysBetween(due, examDate) < 1) return addDays(examDate, -1);
  return due;
}

// ---------------------------------------------------------------------------
// Pacing toward the exam
// ---------------------------------------------------------------------------

export type PaceInput = {
  today: string;
  nclexDate: string | null;
  hesiDate: string | null;
  bufferDays: number;
  remainingStones: number;
  blocks: readonly Pick<StudyBlockView, "weekday" | "minutes">[];
};

function minutesByWeekday(blocks: PaceInput["blocks"]): number[] {
  const byDay = Array.from({ length: 8 }, () => 0);
  for (const b of blocks) if (b.weekday >= 1 && b.weekday <= 7) byDay[b.weekday] += b.minutes;
  return byDay;
}

// The nearest exam still ahead, today included.
export function nextExam(today: string, nclexDate: string | null, hesiDate: string | null): PaceView["exam"] {
  const exams = [
    { kind: "nclex" as const, date: nclexDate },
    { kind: "hesi" as const, date: hesiDate },
  ]
    .filter((e): e is { kind: "nclex" | "hesi"; date: string } => !!e.date && daysBetween(today, e.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const exam = exams[0];
  return exam ? { ...exam, daysLeft: daysBetween(today, exam.date) } : null;
}

export function pace(input: PaceInput): PaceView {
  const byDay = minutesByWeekday(input.blocks);
  const hasBlocks = byDay.some((m) => m > 0);
  const studyWeekdays = hasBlocks ? [1, 2, 3, 4, 5, 6, 7].filter((d) => byDay[d] > 0) : [1, 2, 3, 4, 5, 6, 7];
  const weeklyMinutes = hasBlocks ? byDay.reduce((s, m) => s + m, 0) : DEFAULT_DAY_MINUTES * 7;
  const minutesPerStudyDay = weeklyMinutes / studyWeekdays.length;
  const capacityPerStudyDay = Math.max(0, Math.floor(minutesPerStudyDay / STONE_MINUTES));
  const exam = nextExam(input.today, input.nclexDate, input.hesiDate);
  const remainingStones = Math.max(0, input.remainingStones);

  if (!exam) {
    return {
      exam: null,
      learnBy: null,
      studyDaysLeft: 0,
      remainingStones,
      stonesPerStudyDay: remainingStones > 0 ? Math.max(1, Math.min(capacityPerStudyDay, remainingStones)) : 0,
      capacityPerStudyDay,
      status: remainingStones === 0 ? "done" : "no_exam",
    };
  }

  // New stones stop `bufferDays` before the exam; the buffer is for review.
  const lastLearnDay = addDays(exam.date, -Math.max(0, input.bufferDays) - 1);
  const learnBy = daysBetween(input.today, lastLearnDay) >= 0 ? lastLearnDay : input.today;
  let studyDaysLeft = 0;
  if (daysBetween(input.today, lastLearnDay) >= 0) {
    for (let d = input.today; daysBetween(d, lastLearnDay) >= 0; d = addDays(d, 1)) {
      if (studyWeekdays.includes(isoWeekday(d))) studyDaysLeft++;
    }
  }
  const stonesPerStudyDay = remainingStones === 0 ? 0 : studyDaysLeft > 0 ? Math.ceil(remainingStones / studyDaysLeft) : remainingStones;

  let status: PaceView["status"];
  if (remainingStones === 0) status = "done";
  else if (studyDaysLeft === 0 || stonesPerStudyDay > capacityPerStudyDay) status = "behind";
  else if (stonesPerStudyDay > capacityPerStudyDay * 0.8) status = "tight";
  else status = "on_track";

  return { exam, learnBy, studyDaysLeft, remainingStones, stonesPerStudyDay, capacityPerStudyDay, status };
}

// ---------------------------------------------------------------------------
// Which course each study block goes to
// ---------------------------------------------------------------------------

export type CourseProgress = { id: string; name: string; total: number; mastered: number };

// A block with no course goes to the course with the smallest share mastered (ties: the most stones left).
export function furthestBehind(courses: readonly CourseProgress[]): CourseProgress | null {
  const open = courses.filter((c) => c.total > c.mastered);
  if (!open.length) return null;
  return [...open].sort((a, b) => a.mastered / a.total - b.mastered / b.total || b.total - b.mastered - (a.total - a.mastered))[0];
}

export function blockCourse(block: Pick<StudyBlockView, "courseId">, courses: readonly CourseProgress[]): CourseProgress | null {
  if (block.courseId) return courses.find((c) => c.id === block.courseId) ?? null;
  return furthestBehind(courses);
}

// Minutes per week each course gets from the blocks.
export function weeklyMinutesByCourse(blocks: readonly StudyBlockView[], courses: readonly CourseProgress[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of blocks) {
    const course = blockCourse(b, courses);
    if (course) out.set(course.id, (out.get(course.id) ?? 0) + b.minutes);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Today's plan
// ---------------------------------------------------------------------------

export type PlanStone = TodayStone & { order: number };
export type DueReview = TodayStone & { dueOn: string };

export type TodayInput = {
  today: string;
  blocks: readonly StudyBlockView[];
  courses: readonly CourseProgress[];
  // Every open stone in path order: ready and needs-review stones can be studied today.
  stones: readonly PlanStone[];
  dueReviews: readonly DueReview[];
  pace: PaceView;
};

export type TodayPlan = Pick<TodayView, "day" | "weekday" | "blocks" | "plannedMinutes" | "reviews" | "reviewsDueTotal" | "learn" | "learnGoal" | "questionsGoal">;

export function planToday(input: TodayInput): TodayPlan {
  const weekday = isoWeekday(input.today);
  const todays = input.blocks.filter((b) => b.weekday === weekday).sort((a, b) => a.start.localeCompare(b.start));
  const blocks = todays.flatMap((b) => {
    const course = blockCourse(b, input.courses);
    return course ? [{ start: b.start, minutes: b.minutes, courseId: course.id, courseName: course.name }] : [];
  });
  const plannedMinutes = input.blocks.length ? todays.reduce((s, b) => s + b.minutes, 0) : DEFAULT_DAY_MINUTES;

  // Reviews first, most overdue first, up to their share of the day (at least one when any are due).
  const due = [...input.dueReviews].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const reviewSlots = due.length ? Math.max(1, Math.floor((plannedMinutes * REVIEW_SHARE) / REVIEW_MINUTES)) : 0;
  const reviews = due.slice(0, reviewSlots).map((r) => ({ ...r, overdueDays: Math.max(0, daysBetween(r.dueOn, input.today)) }));
  let left = plannedMinutes - reviews.length * REVIEW_MINUTES;

  // New stones: today's pace, as many as fit. Stones that slipped come first, then the courses of today's blocks.
  const fit = Math.floor(Math.max(0, left) / STONE_MINUTES);
  const learnGoal = input.pace.remainingStones === 0 ? 0 : Math.min(Math.max(1, input.pace.stonesPerStudyDay), Math.max(fit, plannedMinutes > 0 ? 1 : 0));
  const courseOrder = [...new Set([...blocks.map((b) => b.courseId), ...(furthestBehind(input.courses) ? [furthestBehind(input.courses)!.id] : [])])];
  const rank = (s: PlanStone) => {
    const courseRank = courseOrder.indexOf(s.courseId);
    return [s.status === "needs_review" ? 0 : 1, courseRank === -1 ? courseOrder.length : courseRank, s.order] as const;
  };
  const candidates = input.stones
    .filter((s) => s.status === "ready" || s.status === "needs_review")
    .sort((a, b) => {
      const [ra, rb] = [rank(a), rank(b)];
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
    });
  const learn = candidates.slice(0, learnGoal).map(({ order: _order, ...s }) => s);
  left -= learn.length * STONE_MINUTES;

  const questionsGoal = plannedMinutes > 0 ? Math.min(50, Math.max(5, Math.round(Math.max(0, left) / QUESTION_MINUTES))) : 0;
  return {
    day: input.today,
    weekday,
    blocks,
    plannedMinutes,
    reviews,
    reviewsDueTotal: due.length,
    learn,
    learnGoal,
    questionsGoal,
  };
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

// A day counts once something was studied. The streak survives until the end of today,
// so a streak through yesterday is still alive this morning.
export function streak(activeDays: Iterable<string>, today: string): StreakView {
  const days = new Set([...activeDays].filter(isDay));
  const activeToday = days.has(today);
  let current = 0;
  for (let d = activeToday ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) current++;

  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of [...days].sort()) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best: Math.max(best, current), activeToday };
}

// ---------------------------------------------------------------------------
// Weekly report
// ---------------------------------------------------------------------------

export type ReportDay = { day: string; minutes: number; stones: number; questions: number; reviews: number };

export type WeeklyReportInput = {
  weekStart: string;
  today: string;
  days: readonly ReportDay[];
  blocks: readonly Pick<StudyBlockView, "weekday" | "minutes">[];
  answers: { thisWeek: { correct: number; total: number }; lastWeek: { correct: number; total: number } };
  mastered: { id: string; title: string }[];
  slipped: { id: string; title: string }[];
  weakAreas: string[];
  behindCourse: string | null;
};

export function weeklyReport(input: WeeklyReportInput): WeeklyReportView {
  const weekEnd = addDays(input.weekStart, 6);
  const complete = daysBetween(weekEnd, input.today) > 0;
  const inWeek = input.days.filter((d) => daysBetween(input.weekStart, d.day) >= 0 && daysBetween(d.day, weekEnd) >= 0);
  const active = (d: ReportDay) => d.minutes > 0 || d.stones > 0 || d.questions > 0 || d.reviews > 0;

  // Planned minutes: the whole week once it's over, else the days so far.
  const lastDay = complete ? weekEnd : input.today;
  const byDay = minutesByWeekday(input.blocks);
  let minutesPlanned = 0;
  for (let d = input.weekStart; daysBetween(d, lastDay) >= 0; d = addDays(d, 1)) minutesPlanned += byDay[isoWeekday(d)];

  const share = (a: { correct: number; total: number }) => (a.total > 0 ? a.correct / a.total : null);
  const accuracy = share(input.answers.thisWeek);
  const before = share(input.answers.lastWeek);

  const slippedIds = new Set(input.slipped.map((s) => s.id));
  const nextFocus = [
    ...input.slipped.slice(0, 2).map((s) => `Relearn ${s.title}`),
    ...input.weakAreas.slice(0, 2).map((w) => `Practice ${w}`),
    ...(input.behindCourse ? [`More time on ${input.behindCourse}`] : []),
  ].slice(0, 3);

  return {
    weekStart: input.weekStart,
    weekEnd,
    complete,
    minutesStudied: inWeek.reduce((s, d) => s + d.minutes, 0),
    minutesPlanned,
    daysStudied: inWeek.filter(active).length,
    questions: inWeek.reduce((s, d) => s + d.questions, 0),
    accuracy,
    accuracyChange: accuracy !== null && before !== null ? accuracy - before : null,
    reviews: inWeek.reduce((s, d) => s + d.reviews, 0),
    mastered: input.mastered.filter((m) => !slippedIds.has(m.id)),
    slipped: input.slipped,
    nextFocus,
  };
}

// ---------------------------------------------------------------------------
// A daily reminder as a calendar file, for calendars that take .ics files
// ---------------------------------------------------------------------------

export function reminderIcs(input: { time: string; timeZone: string; startDay: string; now: Date; uid: string }): string {
  const time = cleanTime(input.time) ?? "19:00";
  const stamp = input.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = `${input.startDay.replace(/-/g, "")}T${time.replace(":", "")}00`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LPN MasterGuide//Study reminder//EN",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${input.timeZone}:${start}`,
    "DURATION:PT15M",
    "RRULE:FREQ=DAILY",
    "SUMMARY:Study time: LPN MasterGuide",
    "DESCRIPTION:Open LPN MasterGuide for today's reviews and stones.",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Study time",
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
