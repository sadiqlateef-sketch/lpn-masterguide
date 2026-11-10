import { describe, expect, it } from "vitest";
import { buildPathView, computeReadiness, HESI_MIN_ATTEMPTS, projectHesi, smoothedAccuracy, trendSince, weekStartOf, weeklyTrend } from "@/lib/server/progress";

const benchmarks = [
  { id: "excellent", min_score: 950, max_score: null, label: "Excellent", meaning: "" },
  { id: "recommended", min_score: 900, max_score: 949, label: "Recommended", meaning: "" },
  { id: "acceptable", min_score: 850, max_score: 899, label: "Acceptable", meaning: "" },
  { id: "needs_work", min_score: 800, max_score: 849, label: "Needs Work", meaning: "" },
  { id: "at_risk", min_score: 0, max_score: 799, label: "At Risk", meaning: "" },
];

const need = (id: string, min: number, max: number, attempts: number, correct: number) => ({
  client_need_id: id,
  name: id,
  min_pct: min,
  max_pct: max,
  attempts,
  correct,
});

describe("readiness", () => {
  it("starts at zero with no HESI projection", () => {
    const view = computeReadiness([need("pharm", 10, 16, 0, 0), need("coordinated_care", 18, 24, 0, 0)], benchmarks, new Map(), { stones: 4, mastered: 0 });
    expect(view.nclexReadiness).toBe(0);
    expect(view.hesi).toBeNull();
    expect(view.questionsToUnlockHesi).toBe(HESI_MIN_ATTEMPTS);
    expect(view.weakCategoryIds).toEqual([]);
  });

  it("weights categories by test plan midpoint and grows with practice", () => {
    const few = computeReadiness([need("pharm", 10, 16, 3, 3), need("coordinated_care", 18, 24, 0, 0)], benchmarks, new Map(), { stones: 0, mastered: 0 });
    const many = computeReadiness([need("pharm", 10, 16, 15, 15), need("coordinated_care", 18, 24, 0, 0)], benchmarks, new Map(), { stones: 0, mastered: 0 });
    expect(few.nclexReadiness).toBeGreaterThan(0);
    expect(many.nclexReadiness).toBeGreaterThan(few.nclexReadiness);
    // Pharm (13% midpoint) fully practiced at 16/17 smoothed, out of 13 + 21 total weight.
    expect(many.nclexReadiness).toBeCloseTo((13 * (16 / 17)) / 34, 5);
  });

  it("projects a HESI score once there are enough answers and picks its band", () => {
    const view = computeReadiness([need("pharm", 10, 16, 18, 13), need("safety_infection", 10, 16, 2, 1)], benchmarks, new Map(), { stones: 0, mastered: 0 });
    expect(view.totalAttempts).toBe(20);
    expect(view.hesi?.projected).toBe(projectHesi(((14 / 20) * 13 + (2 / 4) * 13) / 26));
    expect(view.hesi?.projected).toBe(840);
    expect(view.hesi?.band.id).toBe("needs_work");
  });

  it("maps accuracy to the HESI scale and clamps it", () => {
    expect(projectHesi(0.7)).toBe(900);
    expect(projectHesi(0.8)).toBe(960);
    expect(projectHesi(0)).toBe(480);
    expect(projectHesi(5)).toBe(1200);
    expect(smoothedAccuracy(2, 2)).toBe(0.75);
  });

  it("lists weak areas by exam weight at stake, then untouched areas that have stones", () => {
    const review = new Map([
      ["psychosocial", [{ id: "s1", title: "Therapeutic talk", status: "ready" as const }]],
      ["coordinated_care", [{ id: "s2", title: "Assigning to UAPs", status: "needs_review" as const }]],
    ]);
    const view = computeReadiness(
      [
        need("pharm", 10, 16, 10, 5),
        need("coordinated_care", 18, 24, 10, 6),
        need("basic_care", 7, 13, 10, 9),
        need("psychosocial", 9, 15, 0, 0),
        need("health_promotion", 6, 12, 0, 0),
      ],
      benchmarks,
      review,
      { stones: 2, mastered: 0 },
    );
    expect(view.weakCategoryIds).toEqual(["coordinated_care", "pharm", "psychosocial"]);
    expect(view.categories.find((c) => c.id === "coordinated_care")?.reviewStones[0].title).toBe("Assigning to UAPs");
  });
});

describe("path view", () => {
  it("orders everything by sort order and points at the first stone needing review", () => {
    const stone = (id: string, sort_order: number, status: "locked" | "ready" | "mastered" | "needs_review") => ({
      id,
      title: id,
      summary: null,
      status,
      mastery: 0,
      sort_order,
    });
    const view = buildPathView(
      [
        { id: "fundamentals", name: "Fundamentals" },
        { id: "pharmacology", name: "Pharmacology" },
        { id: "med_surg", name: "Med-Surg" },
      ],
      [
        {
          id: "b2",
          title: "Pharm Book",
          edition: null,
          cover_url: null,
          course_id: "pharmacology",
          created_at: "2026-10-02",
          units: [{ id: "u", title: "U", sort_order: 1, modules: [{ id: "m", title: "M", chapter_number: "1", sort_order: 1, stepping_stones: [stone("p1", 1, "needs_review")] }] }],
        },
        {
          id: "b1",
          title: "Fundamentals Book",
          edition: "9th",
          cover_url: null,
          course_id: "fundamentals",
          created_at: "2026-10-01",
          units: [
            { id: "u2", title: "Second", sort_order: 2, modules: [{ id: "m2", title: "M2", chapter_number: "2", sort_order: 1, stepping_stones: [stone("f3", 1, "locked")] }] },
            {
              id: "u1",
              title: "First",
              sort_order: 1,
              modules: [{ id: "m1", title: "M1", chapter_number: "1", sort_order: 1, stepping_stones: [stone("f2", 2, "ready"), stone("f1", 1, "mastered")] }],
            },
          ],
        },
      ],
    );
    expect(view.courses.map((c) => c.id)).toEqual(["fundamentals", "pharmacology"]);
    expect(view.courses[0].books[0].units.map((u) => u.title)).toEqual(["First", "Second"]);
    expect(view.courses[0].books[0].units[0].modules[0].stones.map((s) => s.id)).toEqual(["f1", "f2"]);
    expect(view.counts).toEqual({ stones: 4, ready: 1, mastered: 1, needsReview: 1 });
    expect(view.nextStoneId).toBe("p1");
  });
});

describe("weekly trend", () => {
  // A Wednesday.
  const now = new Date("2026-11-11T15:00:00Z");

  it("starts weeks on Monday (UTC)", () => {
    expect(weekStartOf(now).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(weekStartOf(new Date("2026-11-09T00:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(weekStartOf(new Date("2026-11-08T23:59:59Z")).toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("buckets answers into the last 8 weeks, oldest first", () => {
    const trend = weeklyTrend(
      [
        { is_correct: true, answered_at: "2026-11-10T08:00:00Z" },
        { is_correct: false, answered_at: "2026-11-09T00:00:00Z" },
        { is_correct: true, answered_at: "2026-11-08T23:00:00Z" },
        { is_correct: true, answered_at: "2026-09-21T10:00:00Z" },
        // Older than 8 weeks: left out.
        { is_correct: false, answered_at: "2026-09-20T10:00:00Z" },
      ],
      now,
    );
    expect(trend).toHaveLength(8);
    expect(trend[0]).toEqual({ weekStart: "2026-09-21", attempts: 1, correct: 1, accuracy: 1 });
    expect(trend[6]).toEqual({ weekStart: "2026-11-02", attempts: 1, correct: 1, accuracy: 1 });
    expect(trend[7]).toEqual({ weekStart: "2026-11-09", attempts: 2, correct: 1, accuracy: 0.5 });
    expect(trend.slice(1, 6).every((w) => w.attempts === 0 && w.accuracy === null)).toBe(true);
  });

  it("asks the database only for the weeks it shows", () => {
    expect(trendSince(now)).toBe("2026-09-21T00:00:00.000Z");
  });

  it("is attached to the readiness view", () => {
    const trend = weeklyTrend([], now);
    const view = computeReadiness([need("pharm", 10, 16, 0, 0)], benchmarks, new Map(), { stones: 0, mastered: 0 }, trend);
    expect(view.trend).toBe(trend);
  });
});
