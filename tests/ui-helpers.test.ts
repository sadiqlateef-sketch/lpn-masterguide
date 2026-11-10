import { describe, expect, it } from "vitest";
import type { PathCourse, PathStone, PathView, StoneStatus, TrendWeek } from "@/lib/api-types";
import {
  connectorPath,
  courseChapters,
  courseOfStone,
  courseStats,
  courseStones,
  findStone,
  neighborCourse,
} from "@/lib/ui/path-view";
import { trendChange, trendLine, trendPoints } from "@/lib/ui/trend";
import { bumpCount, readCount, readString, shouldShowSwipeHint, SWIPE_HINT_LESSONS, writeString } from "@/lib/client/prefs";

const stone = (id: string, status: StoneStatus): PathStone => ({ id, title: id, summary: null, status, mastery: 0 });

const course = (id: string, modules: { id: string; stones: PathStone[] }[]): PathCourse => ({
  id,
  name: id,
  books: [
    {
      id: `${id}-book`,
      title: `${id} book`,
      edition: null,
      coverUrl: null,
      units: [{ id: `${id}-unit`, title: "Unit 1", modules: modules.map((m) => ({ ...m, title: m.id, chapterNumber: null })) }],
    },
  ],
});

const fundamentals = course("fun", [
  { id: "ch1", stones: [stone("a", "mastered"), stone("b", "needs_review")] },
  { id: "ch2", stones: [stone("c", "ready"), stone("d", "locked")] },
]);
const pharm = course("pharm", [{ id: "ch3", stones: [stone("e", "ready")] }]);
const path: PathView = {
  courses: [fundamentals, pharm],
  counts: { stones: 5, ready: 2, mastered: 1, needsReview: 1 },
  nextStoneId: "b",
};

describe("path view helpers", () => {
  it("lists a course's stones in order and counts them", () => {
    expect(courseStones(fundamentals).map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    expect(courseStats(fundamentals)).toEqual({ total: 4, mastered: 1, locked: 1 });
  });

  it("opens on the course that holds the next stone", () => {
    expect(courseOfStone(path, "e")).toBe("pharm");
    expect(courseOfStone(path, "b")).toBe("fun");
    expect(courseOfStone(path, null)).toBe("fun");
    expect(courseOfStone(path, "missing")).toBe("fun");
    expect(courseOfStone({ ...path, courses: [] }, null)).toBeNull();
  });

  it("finds a stone anywhere on the path", () => {
    expect(findStone(path, "e")?.status).toBe("ready");
    expect(findStone(path, "zzz")).toBeNull();
    expect(findStone(path, null)).toBeNull();
  });

  it("builds the chapter list with progress and the next-stone marker", () => {
    const chapters = courseChapters(fundamentals, "b");
    expect(chapters.map((c) => [c.module.id, c.mastered, c.total, c.hasNext])).toEqual([
      ["ch1", 1, 2, true],
      ["ch2", 0, 2, false],
    ]);
    expect(chapters[0].bookTitle).toBe("fun book");
  });

  it("moves between courses and stops at either end", () => {
    expect(neighborCourse(path.courses, "fun", 1)).toBe("pharm");
    expect(neighborCourse(path.courses, "pharm", -1)).toBe("fun");
    expect(neighborCourse(path.courses, "pharm", 1)).toBeNull();
    expect(neighborCourse(path.courses, "fun", -1)).toBeNull();
    expect(neighborCourse(path.courses, "nope", 1)).toBeNull();
  });

  it("draws one S-curve per hop between stone centers", () => {
    expect(connectorPath([])).toBe("");
    expect(connectorPath([{ x: 0, y: 0 }])).toBe("");
    expect(connectorPath([{ x: 10, y: 0 }, { x: 40, y: 100 }])).toBe("M 10 0 C 10 50, 40 50, 40 100");
    const d = connectorPath([
      { x: 0, y: 0 },
      { x: 20, y: 50 },
      { x: 0, y: 100.04 },
    ]);
    expect(d.match(/C/g)).toHaveLength(2);
    expect(d.endsWith("0 100")).toBe(true);
  });
});

const week = (accuracy: number | null, attempts = accuracy === null ? 0 : 10): TrendWeek => ({
  weekStart: "2026-11-02",
  attempts,
  correct: accuracy === null ? 0 : Math.round(attempts * accuracy),
  accuracy,
});

describe("trend chart helpers", () => {
  it("places practiced weeks and leaves gaps for empty ones", () => {
    const points = trendPoints([week(0.5), week(null), week(1)], 116, 66, 8);
    expect(points.map((p) => [p.x, p.y])).toEqual([
      [8, 33],
      [108, 8],
    ]);
    expect(trendPoints([], 100, 50)).toEqual([]);
    expect(trendPoints([week(0)], 100, 50, 10)).toEqual([{ x: 10, y: 40, week: week(0) }]);
  });

  it("joins the points into one line", () => {
    const points = trendPoints([week(0.5), week(1)], 116, 66, 8);
    expect(trendLine(points)).toBe("M 8 33 L 108 8");
    expect(trendLine([])).toBe("");
  });

  it("reports the change from the first practiced week to the last", () => {
    expect(trendChange([week(null), week(0.5), week(null), week(0.75)])).toBe(25);
    expect(trendChange([week(0.8), week(0.6)])).toBe(-20);
    expect(trendChange([week(null), week(0.7)])).toBeNull();
    expect(trendChange([])).toBeNull();
  });
});

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

const brokenStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("device preferences", () => {
  it("counts lessons seen and hides the swipe hint after a few", () => {
    const store = memoryStore();
    expect(readCount("k", store)).toBe(0);
    for (let i = 0; i < SWIPE_HINT_LESSONS; i++) {
      expect(shouldShowSwipeHint(readCount("k", store))).toBe(true);
      bumpCount("k", store);
    }
    expect(readCount("k", store)).toBe(SWIPE_HINT_LESSONS);
    expect(shouldShowSwipeHint(readCount("k", store))).toBe(false);
  });

  it("treats junk counts as zero", () => {
    expect(readCount("k", memoryStore({ k: "abc" }))).toBe(0);
    expect(readCount("k", memoryStore({ k: "-4" }))).toBe(0);
    expect(readCount("k", memoryStore({ k: "2.7" }))).toBe(2);
  });

  it("keeps working when storage is missing or blocked", () => {
    expect(readCount("k", null)).toBe(0);
    expect(bumpCount("k", null)).toBe(1);
    expect(readCount("k", brokenStore)).toBe(0);
    expect(bumpCount("k", brokenStore)).toBe(1);
    expect(readString("k", brokenStore)).toBeNull();
    expect(() => writeString("k", "v", brokenStore)).not.toThrow();
  });

  it("remembers a chosen course", () => {
    const store = memoryStore();
    expect(readString("lpn:path-course", store)).toBeNull();
    writeString("lpn:path-course", "pharm", store);
    expect(readString("lpn:path-course", store)).toBe("pharm");
  });
});
