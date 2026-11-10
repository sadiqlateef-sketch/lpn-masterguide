import { describe, expect, it } from "vitest";
import {
  addDays,
  blockCourse,
  cleanTime,
  DEFAULT_DAY_MINUTES,
  daysBetween,
  furthestBehind,
  gradeFromScore,
  isDay,
  isoWeekday,
  isValidTimeZone,
  localDay,
  nextExam,
  nextReview,
  pace,
  planToday,
  reminderIcs,
  reviewDueOn,
  START_EASE,
  streak,
  weekStart,
  weeklyMinutesByCourse,
  weeklyReport,
  type PlanStone,
} from "@/lib/study-math";
import type { PaceView } from "@/lib/api-types";

describe("calendar days", () => {
  it("adds and counts days across months, years and daylight saving", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08"); // US clocks change that night
    expect(daysBetween("2026-11-01", "2026-11-10")).toBe(9);
    expect(daysBetween("2026-11-10", "2026-11-01")).toBe(-9);
  });

  it("knows ISO weekdays and week starts", () => {
    expect(isoWeekday("2026-11-09")).toBe(1); // Monday
    expect(isoWeekday("2026-11-15")).toBe(7); // Sunday
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
  });

  it("rejects days that don't exist", () => {
    expect(isDay("2026-02-28")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("11/10/2026")).toBe(false);
  });

  it("reads the day in the student's own time zone around midnight", () => {
    const lateEvening = new Date("2026-11-11T03:30:00Z");
    expect(localDay(lateEvening, "America/New_York")).toBe("2026-11-10");
    expect(localDay(lateEvening, "UTC")).toBe("2026-11-11");
    expect(localDay(new Date("2026-11-10T16:00:00Z"), "Asia/Tokyo")).toBe("2026-11-11");
    // A made-up zone falls back to UTC rather than crashing.
    expect(localDay(lateEvening, "Mars/Olympus")).toBe("2026-11-11");
  });

  it("checks time zones and times", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(cleanTime("07:05:00")).toBe("07:05");
    expect(cleanTime("24:00")).toBeNull();
    expect(cleanTime("7pm")).toBeNull();
  });
});

describe("spaced review", () => {
  const first = { intervalDays: 1, ease: START_EASE, reps: 1, lapses: 0 };

  it("grades a round by the share right", () => {
    expect(gradeFromScore(5, 5)).toBe("easy");
    expect(gradeFromScore(4, 5)).toBe("good");
    expect(gradeFromScore(3, 5)).toBe("hard");
    expect(gradeFromScore(2, 5)).toBe("again");
    expect(gradeFromScore(0, 0)).toBe("again");
  });

  it("follows the 1, 6, then times-ease ladder on good reviews", () => {
    const second = nextReview(first, "good");
    expect(second.intervalDays).toBe(6);
    expect(second.reps).toBe(2);
    expect(second.ease).toBe(2.5);
    const third = nextReview(second, "good");
    expect(third.intervalDays).toBe(15);
    const fourth = nextReview(third, "good");
    expect(fourth.intervalDays).toBe(38);
  });

  it("goes further on easy, shorter on hard, and never below a day", () => {
    expect(nextReview(first, "easy").intervalDays).toBe(8);
    expect(nextReview(first, "easy").ease).toBeCloseTo(2.6);
    const hard = nextReview(first, "hard");
    expect(hard.intervalDays).toBe(3);
    expect(hard.ease).toBeCloseTo(2.36);
    expect(nextReview({ intervalDays: 10, ease: 1.3, reps: 4, lapses: 0 }, "hard").intervalDays).toBe(12);
  });

  it("starts over after a miss and lowers ease, but not below the floor", () => {
    const missed = nextReview({ intervalDays: 30, ease: 2.5, reps: 5, lapses: 0 }, "again");
    expect(missed).toEqual({ intervalDays: 1, ease: 2.3, reps: 0, lapses: 1 });
    expect(nextReview({ intervalDays: 3, ease: 1.35, reps: 2, lapses: 2 }, "again").ease).toBe(1.3);
  });

  it("caps intervals at 180 days", () => {
    expect(nextReview({ intervalDays: 150, ease: 3.5, reps: 8, lapses: 0 }, "easy").intervalDays).toBe(180);
  });

  it("pulls a review that would land on or after the exam to the day before", () => {
    expect(reviewDueOn("2026-11-10", 6, null)).toBe("2026-11-16");
    expect(reviewDueOn("2026-11-10", 6, "2026-11-14")).toBe("2026-11-13");
    expect(reviewDueOn("2026-11-10", 2, "2026-11-20")).toBe("2026-11-12");
    // The exam is tomorrow: nothing sensible to pull to, keep the interval.
    expect(reviewDueOn("2026-11-10", 6, "2026-11-11")).toBe("2026-11-16");
  });
});

describe("pacing toward the exam", () => {
  const evenings = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, minutes: 60 }));

  it("picks the nearest exam still ahead", () => {
    expect(nextExam("2026-11-10", "2027-03-01", "2027-01-15")).toEqual({ kind: "hesi", date: "2027-01-15", daysLeft: 66 });
    expect(nextExam("2026-11-10", "2027-03-01", "2026-11-01")?.kind).toBe("nclex");
    expect(nextExam("2026-11-10", null, null)).toBeNull();
  });

  it("counts only days with study blocks, before the review buffer", () => {
    // Monday Nov 9 to the day before a 14-day buffer ahead of Dec 7: Nov 9 to Nov 22 has 10 weekdays.
    const view = pace({ today: "2026-11-09", nclexDate: "2026-12-07", hesiDate: null, bufferDays: 14, remainingStones: 20, blocks: evenings });
    expect(view.learnBy).toBe("2026-11-22");
    expect(view.studyDaysLeft).toBe(10);
    expect(view.stonesPerStudyDay).toBe(2);
    expect(view.capacityPerStudyDay).toBe(3);
    expect(view.status).toBe("on_track");
  });

  it("says tight when the pace is close to the time there is, and behind past it", () => {
    const tight = pace({ today: "2026-11-09", nclexDate: "2026-12-07", hesiDate: null, bufferDays: 14, remainingStones: 30, blocks: evenings });
    expect(tight.stonesPerStudyDay).toBe(3);
    expect(tight.status).toBe("tight");
    const behind = pace({ today: "2026-11-09", nclexDate: "2026-12-07", hesiDate: null, bufferDays: 14, remainingStones: 40, blocks: evenings });
    expect(behind.status).toBe("behind");
  });

  it("is behind once inside the buffer with stones left, and done with none", () => {
    const late = pace({ today: "2026-12-01", nclexDate: "2026-12-07", hesiDate: null, bufferDays: 14, remainingStones: 3, blocks: evenings });
    expect(late.studyDaysLeft).toBe(0);
    expect(late.learnBy).toBe("2026-12-01");
    expect(late.status).toBe("behind");
    expect(pace({ today: "2026-12-01", nclexDate: "2026-12-07", hesiDate: null, bufferDays: 14, remainingStones: 0, blocks: evenings }).status).toBe("done");
  });

  it("plans every day at the default length when no study times are saved", () => {
    const view = pace({ today: "2026-11-09", nclexDate: "2026-11-30", hesiDate: null, bufferDays: 7, remainingStones: 14, blocks: [] });
    expect(view.studyDaysLeft).toBe(14);
    expect(view.capacityPerStudyDay).toBe(Math.floor(DEFAULT_DAY_MINUTES / 20));
    expect(view.stonesPerStudyDay).toBe(1);
  });

  it("without an exam date it still suggests a daily amount", () => {
    const view = pace({ today: "2026-11-09", nclexDate: null, hesiDate: null, bufferDays: 14, remainingStones: 9, blocks: evenings });
    expect(view.status).toBe("no_exam");
    expect(view.stonesPerStudyDay).toBe(3);
  });
});

const courses = [
  { id: "fundamentals", name: "Fundamentals", total: 10, mastered: 8 },
  { id: "pharmacology", name: "Pharmacology", total: 20, mastered: 2 },
  { id: "med_surg", name: "Med-Surg", total: 5, mastered: 5 },
];

describe("study blocks and courses", () => {
  it("sends an open block to the course furthest behind", () => {
    expect(furthestBehind(courses)?.id).toBe("pharmacology");
    expect(blockCourse({ courseId: null }, courses)?.id).toBe("pharmacology");
    expect(blockCourse({ courseId: "fundamentals" }, courses)?.id).toBe("fundamentals");
    expect(furthestBehind([{ id: "a", name: "A", total: 2, mastered: 2 }])).toBeNull();
  });

  it("totals the weekly minutes per course", () => {
    const minutes = weeklyMinutesByCourse(
      [
        { weekday: 1, start: "19:00", minutes: 45, courseId: "fundamentals" },
        { weekday: 2, start: "19:00", minutes: 30, courseId: null },
        { weekday: 3, start: "19:00", minutes: 30, courseId: null },
      ],
      courses,
    );
    expect(Object.fromEntries(minutes)).toEqual({ fundamentals: 45, pharmacology: 60 });
  });
});

describe("today's plan", () => {
  const onTrack: PaceView = { exam: null, learnBy: null, studyDaysLeft: 0, remainingStones: 12, stonesPerStudyDay: 2, capacityPerStudyDay: 3, status: "no_exam" };
  const stones: PlanStone[] = [
    { id: "f1", title: "Vital signs", courseId: "fundamentals", status: "ready", order: 1 },
    { id: "p1", title: "Beta blockers", courseId: "pharmacology", status: "ready", order: 2 },
    { id: "p0", title: "ACE inhibitors", courseId: "pharmacology", status: "needs_review", order: 0 },
    { id: "m1", title: "Locked one", courseId: "med_surg", status: "locked", order: 3 },
  ];
  const due = [
    { id: "r2", title: "Hand hygiene", courseId: "fundamentals", status: "mastered" as const, dueOn: "2026-11-09" },
    { id: "r1", title: "PPE order", courseId: "fundamentals", status: "mastered" as const, dueOn: "2026-11-07" },
  ];

  it("puts overdue reviews first, then slipped stones, then today's course", () => {
    const plan = planToday({
      today: "2026-11-10", // Tuesday
      blocks: [{ weekday: 2, start: "19:00", minutes: 60, courseId: "fundamentals" }],
      courses,
      stones,
      dueReviews: due,
      pace: onTrack,
    });
    expect(plan.plannedMinutes).toBe(60);
    expect(plan.blocks).toEqual([{ start: "19:00", minutes: 60, courseId: "fundamentals", courseName: "Fundamentals" }]);
    expect(plan.reviews.map((r) => [r.id, r.overdueDays])).toEqual([
      ["r1", 3],
      ["r2", 1],
    ]);
    expect(plan.learnGoal).toBe(2);
    expect(plan.learn.map((s) => s.id)).toEqual(["p0", "f1"]);
    // 60 minutes - 2 reviews x 5 - 2 stones x 20 = 10 minutes of questions, but never fewer than 5.
    expect(plan.questionsGoal).toBe(7);
  });

  it("keeps reviews to their share of the day", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...due[0], id: `r${i}`, dueOn: addDays("2026-11-01", i % 9) }));
    const plan = planToday({ today: "2026-11-10", blocks: [{ weekday: 2, start: "07:00", minutes: 50, courseId: null }], courses, stones, dueReviews: many, pace: onTrack });
    expect(plan.reviews).toHaveLength(4);
    expect(plan.reviewsDueTotal).toBe(20);
    expect(plan.blocks[0].courseId).toBe("pharmacology");
  });

  it("on a day with no study block still offers one review and no new work", () => {
    const plan = planToday({ today: "2026-11-11", blocks: [{ weekday: 2, start: "19:00", minutes: 60, courseId: null }], courses, stones, dueReviews: due, pace: onTrack });
    expect(plan.plannedMinutes).toBe(0);
    expect(plan.reviews).toHaveLength(1);
    expect(plan.learn).toEqual([]);
    expect(plan.questionsGoal).toBe(0);
  });

  it("uses a default day before any study times are saved", () => {
    const plan = planToday({ today: "2026-11-11", blocks: [], courses, stones, dueReviews: [], pace: onTrack });
    expect(plan.plannedMinutes).toBe(DEFAULT_DAY_MINUTES);
    expect(plan.learn).toHaveLength(2);
  });
});

describe("streaks", () => {
  it("counts back from today, or from yesterday until today is studied", () => {
    expect(streak(["2026-11-08", "2026-11-09", "2026-11-10"], "2026-11-10")).toEqual({ current: 3, best: 3, activeToday: true });
    expect(streak(["2026-11-08", "2026-11-09"], "2026-11-10")).toEqual({ current: 2, best: 2, activeToday: false });
    expect(streak(["2026-11-07", "2026-11-08"], "2026-11-10").current).toBe(0);
  });

  it("remembers the best run and ignores junk days", () => {
    const view = streak(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-11-10", "not a day"], "2026-11-10");
    expect(view).toEqual({ current: 1, best: 4, activeToday: true });
  });

  it("carries across a month end", () => {
    expect(streak(["2026-10-31", "2026-11-01"], "2026-11-01").current).toBe(2);
  });
});

describe("weekly report", () => {
  const base = {
    weekStart: "2026-11-02",
    blocks: [1, 3, 5].map((weekday) => ({ weekday, minutes: 40 })),
    answers: { thisWeek: { correct: 16, total: 20 }, lastWeek: { correct: 14, total: 20 } },
    mastered: [
      { id: "a", title: "Digoxin" },
      { id: "b", title: "Insulin" },
    ],
    slipped: [{ id: "b", title: "Insulin" }],
    weakAreas: ["Pharmacological Therapies", "Safety and Infection Control", "Third"],
    behindCourse: "Pharmacology",
  };
  const days = [
    { day: "2026-11-01", minutes: 99, stones: 1, questions: 9, reviews: 0 }, // the Sunday before: not counted
    { day: "2026-11-02", minutes: 35, stones: 1, questions: 10, reviews: 2 },
    { day: "2026-11-04", minutes: 50, stones: 1, questions: 10, reviews: 1 },
    { day: "2026-11-06", minutes: 0, stones: 0, questions: 0, reviews: 0 },
  ];

  it("sums a finished week and compares it with the week before", () => {
    const report = weeklyReport({ ...base, today: "2026-11-10", days });
    expect(report.complete).toBe(true);
    expect(report.weekEnd).toBe("2026-11-08");
    expect(report.minutesStudied).toBe(85);
    expect(report.minutesPlanned).toBe(120);
    expect(report.daysStudied).toBe(2);
    expect(report.questions).toBe(20);
    expect(report.reviews).toBe(3);
    expect(report.accuracy).toBeCloseTo(0.8);
    expect(report.accuracyChange).toBeCloseTo(0.1);
    // A stone mastered and then slipped in the same week is listed as slipped only.
    expect(report.mastered).toEqual([{ id: "a", title: "Digoxin" }]);
    expect(report.nextFocus).toEqual(["Relearn Insulin", "Practice Pharmacological Therapies", "Practice Safety and Infection Control"]);
  });

  it("plans only the days so far in the current week", () => {
    const report = weeklyReport({ ...base, today: "2026-11-04", days, answers: { thisWeek: { correct: 0, total: 0 }, lastWeek: { correct: 5, total: 10 } } });
    expect(report.complete).toBe(false);
    expect(report.minutesPlanned).toBe(80);
    expect(report.accuracy).toBeNull();
    expect(report.accuracyChange).toBeNull();
  });
});

describe("calendar reminder", () => {
  it("repeats daily at the chosen time in the student's zone", () => {
    const ics = reminderIcs({ time: "19:30", timeZone: "America/New_York", startDay: "2026-11-11", now: new Date("2026-11-10T22:00:00.123Z"), uid: "x@lpn" });
    expect(ics).toContain("DTSTART;TZID=America/New_York:20261111T193000");
    expect(ics).toContain("RRULE:FREQ=DAILY");
    expect(ics).toContain("DTSTAMP:20261110T220000Z");
    expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
  });
});
