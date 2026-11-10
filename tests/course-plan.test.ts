import { describe, expect, it } from "vitest";
import type { PathCourse } from "@/lib/api-types";
import {
  pickCheckpoint,
  planFingerprint,
  planPrompt,
  planStones,
  tidyPlan,
  weekCoverage,
  weekSources,
  type PlanStone,
} from "@/lib/server/course-plan";
import type { PracticeRow } from "@/lib/server/practice";

const stone = (id: string, extra: Partial<PlanStone> = {}): PlanStone => ({
  id,
  title: `Stone ${id}`,
  status: "ready",
  chapter: "Chapter 1: Cardiac",
  book: "Pharm",
  passages: 0,
  pageFrom: null,
  pageTo: null,
  notes: 0,
  notebooks: [],
  questions: 0,
  ...extra,
});

const stones = ["a", "b", "c", "d", "e"].map((id) => stone(id));

describe("planStones", () => {
  it("lists the course's stones in path order with their sources", () => {
    const course: PathCourse = {
      id: "pharmacology",
      name: "Pharmacology",
      books: [
        {
          id: "b",
          title: "Pharm",
          edition: null,
          coverUrl: null,
          units: [
            {
              id: "u",
              title: "U1",
              modules: [
                {
                  id: "m",
                  title: "Cardiac",
                  chapterNumber: "4",
                  stones: [
                    { id: "s1", title: "Digoxin", summary: null, status: "ready", mastery: 0 },
                    { id: "s2", title: "Beta blockers", summary: null, status: "locked", mastery: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const list = planStones(course, [
      { stone_id: "s2", book: "Pharm", passages: 3, page_from: 80, page_to: 84, notes: 2, notebooks: ["Pharm notebook"], questions: 1 },
    ]);
    expect(list.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(list[0]).toMatchObject({ chapter: "Chapter 4: Cardiac", passages: 0, notebooks: [] });
    expect(list[1]).toMatchObject({ passages: 3, pageFrom: 80, pageTo: 84, notes: 2, notebooks: ["Pharm notebook"], questions: 1, status: "locked" });
  });
});

describe("planPrompt", () => {
  it("numbers stones and says what stands behind each", () => {
    const text = planPrompt("Pharmacology", [
      stone("a", { passages: 2, pageFrom: 10, pageTo: 12, notes: 1, notebooks: ["Pharm"] }),
      stone("b"),
    ]);
    expect(text).toContain("S1: Stone a [textbook pp. 10-12; 1 note passage (Pharm)]");
    expect(text).toContain("S2: Stone b [outline only]");
    expect(text).toContain("Pharm, Chapter 1: Cardiac");
  });
});

describe("tidyPlan", () => {
  it("keeps every stone exactly once and in path order", () => {
    const plan = tidyPlan(
      {
        summary: " Two weeks. ",
        weeks: [
          { title: "Start", goals: ["Goal 1"], stone_refs: ["S1", "S2", "S2", "S99"] },
          { title: "Late", goals: [], stone_refs: ["S5"] },
          { title: "Middle", goals: ["Goal 2"], stone_refs: ["s4", "nonsense"] },
        ],
      },
      stones,
    );
    // S3 was left out, so it joins the week before it; S5 sits after S4, so it can't go back to an earlier week.
    expect(plan.summary).toBe("Two weeks.");
    expect(plan.weeks.map((w) => w.stoneIds)).toEqual([["a", "b", "c"], ["d", "e"]]);
    expect(plan.weeks.map((w) => w.title)).toEqual(["Start", "Middle"]);
  });

  it("falls back to stone titles when the model gives no weeks or goals", () => {
    const plan = tidyPlan({ summary: "", weeks: [] }, stones.slice(0, 2));
    expect(plan.weeks).toEqual([{ title: "Stone a", goals: ["Stone a", "Stone b"], stoneIds: ["a", "b"] }]);
  });

  it("trims goals to four short lines", () => {
    const plan = tidyPlan({ summary: "", weeks: [{ title: "W", goals: ["1", "2", "3", "4", "5", "x".repeat(300)], stone_refs: ["S1"] }] }, stones.slice(0, 1));
    expect(plan.weeks[0].goals).toEqual(["1", "2", "3", "4"]);
  });

  it("refuses a course with no stones", () => {
    expect(() => tidyPlan({ summary: "", weeks: [] }, [])).toThrow(/no stones/);
  });
});

describe("weekSources and weekCoverage", () => {
  const sourced = [
    stone("a", { passages: 2, pageFrom: 10, pageTo: 12, notes: 2, notebooks: ["Pharm"] }),
    stone("b", { passages: 1, pageFrom: 15, pageTo: 15, notes: 1 }),
    stone("c", { questions: 3 }),
  ];

  it("counts the pages, notebooks and questions behind a week", () => {
    expect(weekSources(sourced)).toEqual({
      textbookPages: [{ book: "Pharm", pages: "pp. 10-15" }],
      notebooks: [
        { name: "My notes", notes: 1 },
        { name: "Pharm", notes: 2 },
      ],
      questions: 3,
    });
  });

  it("says how well a week is covered", () => {
    expect(weekCoverage(sourced.slice(0, 2))).toBe("full");
    expect(weekCoverage(sourced)).toBe("partial");
    expect(weekCoverage([stone("x", { questions: 1 })])).toBe("partial");
    expect(weekCoverage([stone("x")])).toBe("outline_only");
  });
});

describe("planFingerprint", () => {
  it("changes when a source changes, not when notebooks are listed in another order", () => {
    const base = planFingerprint([stone("a", { notebooks: ["A", "B"] })], "m");
    expect(planFingerprint([stone("a", { notebooks: ["B", "A"] })], "m")).toBe(base);
    expect(planFingerprint([stone("a", { notebooks: ["A", "B"], passages: 1 })], "m")).not.toBe(base);
    expect(planFingerprint([stone("a", { notebooks: ["A", "B"] })], "other")).not.toBe(base);
  });
});

describe("pickCheckpoint", () => {
  const row = (id: string, stoneId: string): PracticeRow => ({ id, stone_id: stoneId, item_type: "lesson_mcq", origin_question_id: null, payload: { stem: "", options: [], correct_option_ids: [], rationale: "" } });

  it("takes one question per stone in turn, up to the size", () => {
    const rows = [row("a1", "a"), row("a2", "a"), row("a3", "a"), row("b1", "b"), row("c1", "c")];
    expect(pickCheckpoint(["a", "b", "c"], rows, 4).map((r) => r.id)).toEqual(["a1", "b1", "c1", "a2"]);
    expect(pickCheckpoint(["a"], rows, 10).map((r) => r.id)).toEqual(["a1", "a2", "a3"]);
    expect(pickCheckpoint(["z"], rows)).toEqual([]);
  });
});
