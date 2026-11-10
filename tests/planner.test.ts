import { describe, expect, it } from "vitest";
import type { PathView } from "@/lib/api-types";
import { ApiError } from "@/lib/server/http";
import { cleanBlocks, DEFAULT_PROFILE, mergeProfile, pathProgress, profileView } from "@/lib/server/planner";
import { buildPathView } from "@/lib/server/progress";

const today = "2026-11-10";

describe("planner profile", () => {
  it("defaults until saved, and reads the database row", () => {
    expect(profileView(null)).toEqual(DEFAULT_PROFILE);
    expect(
      profileView({ nclex_date: "2027-03-01", hesi_date: null, reminder_time: "19:30:00", timezone: "America/New_York", review_buffer_days: 10 }),
    ).toEqual({ nclexDate: "2027-03-01", hesiDate: null, reminderTime: "19:30", timezone: "America/New_York", reviewBufferDays: 10 });
  });

  it("changes only the fields sent and clears a date sent as empty", () => {
    const start = { ...DEFAULT_PROFILE, nclexDate: "2027-03-01", hesiDate: "2027-01-10" };
    expect(mergeProfile(start, { hesiDate: "" }, today)).toEqual({ ...start, hesiDate: null });
    expect(mergeProfile(start, { reminderTime: "07:15", timezone: "America/Chicago" }, today)).toEqual({
      ...start,
      reminderTime: "07:15",
      timezone: "America/Chicago",
    });
  });

  it("refuses dates, times and zones that don't make sense", () => {
    const bad = (input: Parameters<typeof mergeProfile>[1], code: string) => {
      try {
        mergeProfile(DEFAULT_PROFILE, input, today);
        throw new Error("accepted");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).code).toBe(code);
      }
    };
    bad({ nclexDate: "2027-02-30" }, "bad_date");
    bad({ nclexDate: "2037-01-01" }, "bad_date");
    bad({ reminderTime: "25:00" }, "bad_time");
    bad({ timezone: "Mars/Olympus" }, "bad_timezone");
    bad({ reviewBufferDays: 61 }, "bad_buffer");
  });
});

describe("study blocks", () => {
  it("sorts the week and trims seconds off times", () => {
    expect(
      cleanBlocks([
        { weekday: 3, start: "06:30:00", minutes: 30, courseId: null },
        { weekday: 1, start: "19:00", minutes: 45, courseId: "pharmacology" },
      ]),
    ).toEqual([
      { weekday: 1, start: "19:00", minutes: 45, courseId: "pharmacology" },
      { weekday: 3, start: "06:30", minutes: 30, courseId: null },
    ]);
  });

  it("refuses overlaps, odd lengths and unknown courses", () => {
    const code = (blocks: Parameters<typeof cleanBlocks>[0]) => {
      try {
        cleanBlocks(blocks);
        return "accepted";
      } catch (e) {
        return (e as ApiError).code;
      }
    };
    expect(
      code([
        { weekday: 1, start: "19:00", minutes: 60, courseId: null },
        { weekday: 1, start: "19:30", minutes: 30, courseId: null },
      ]),
    ).toBe("overlap");
    // Back to back is fine.
    expect(
      code([
        { weekday: 1, start: "19:00", minutes: 30, courseId: null },
        { weekday: 1, start: "19:30", minutes: 30, courseId: null },
      ]),
    ).toBe("accepted");
    expect(code([{ weekday: 1, start: "19:00", minutes: 5, courseId: null }])).toBe("bad_block");
    expect(code([{ weekday: 0, start: "19:00", minutes: 30, courseId: null }])).toBe("bad_block");
    expect(code([{ weekday: 1, start: "7pm", minutes: 30, courseId: null }])).toBe("bad_block");
    expect(code([{ weekday: 1, start: "19:00", minutes: 30, courseId: "astronomy" }])).toBe("bad_block");
    expect(code(Array.from({ length: 29 }, (_, i) => ({ weekday: (i % 7) + 1, start: `0${i % 7}:00`.slice(-5), minutes: 10, courseId: null })))).toBe("too_many_blocks");
  });
});

describe("path for the planner", () => {
  const book = (course_id: string, stones: [string, "ready" | "mastered" | "locked" | "needs_review"][]) => ({
    id: `b-${course_id}`,
    title: course_id,
    edition: null,
    cover_url: null,
    course_id,
    created_at: "2026-11-01",
    units: [
      {
        id: `u-${course_id}`,
        title: "U",
        sort_order: 1,
        modules: [
          {
            id: `m-${course_id}`,
            title: "M",
            chapter_number: "1",
            sort_order: 1,
            stepping_stones: stones.map(([id, status], i) => ({ id, title: id.toUpperCase(), summary: null, status, mastery: 0, sort_order: i })),
          },
        ],
      },
    ],
  });
  const courses = [
    { id: "fundamentals", name: "Fundamentals" },
    { id: "pharmacology", name: "Pharmacology" },
  ];

  it("marks mastered stones whose review is due, and only those", () => {
    const path = buildPathView(courses, [book("fundamentals", [["f1", "mastered"], ["f2", "ready"]])], new Set(["f1", "f2"]));
    const stones = path.courses[0].books[0].units[0].modules[0].stones;
    expect(stones[0].dueForReview).toBe(true);
    expect(stones[1].dueForReview).toBeUndefined();
    expect(path.counts.dueForReview).toBe(1);
  });

  it("lists stones in path order with their course and progress", () => {
    const path: PathView = buildPathView(courses, [
      book("pharmacology", [["p1", "mastered"], ["p2", "ready"], ["p3", "locked"]]),
      book("fundamentals", [["f1", "needs_review"]]),
    ]);
    const { courses: progress, stones, courseOf } = pathProgress(path);
    expect(progress).toEqual([
      { id: "fundamentals", name: "Fundamentals", total: 1, mastered: 0 },
      { id: "pharmacology", name: "Pharmacology", total: 3, mastered: 1 },
    ]);
    expect(stones.map((s) => `${s.id}:${s.order}`)).toEqual(["f1:0", "p1:1", "p2:2", "p3:3"]);
    expect(courseOf.get("p2")).toBe("pharmacology");
  });
});
