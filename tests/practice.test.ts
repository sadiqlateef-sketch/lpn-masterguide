import { describe, expect, it } from "vitest";
import type { Bowtie } from "@/lib/server/ai-schemas";
import { ApiError } from "@/lib/server/http";
import { gradeBowtie, gradeChoice, toPracticeView, type ChoicePayload, type PracticeRow } from "@/lib/server/practice";
import { lessonScore } from "@/lib/server/progress";
import { togglePick } from "@/lib/quick-play";

const options = ["A", "B", "C", "D", "E"].map((id) => ({ id, text: `Option ${id}` }));
const single: ChoicePayload = { stem: "Which first?", options: options.slice(0, 4), correct_option_ids: ["B"], rationale: "Airway first.", lpn_scope_note: "Within scope." };
const sata: ChoicePayload = { stem: "Select all", options, correct_option_ids: ["A", "C", "E"], rationale: "Three are right." };
const bowtie: Bowtie = {
  scenario: "A client after surgery...",
  condition: { prompt: "Most likely?", options: options.slice(0, 4), correct_option_id: "A" },
  actions: { prompt: "Actions", options, correct_option_ids: ["B", "D"] },
  parameters: { prompt: "Monitor", options, correct_option_ids: ["A", "E"] },
  rationale: "Because.",
};

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof ApiError ? error.code : "other";
  }
  return null;
};

describe("grading", () => {
  it("grades single-answer questions", () => {
    expect(gradeChoice(single, ["B"])).toMatchObject({ correct: true, score: 1, correctOptionIds: ["B"], scopeNote: "Within scope.", selectedIds: ["B"] });
    expect(gradeChoice(single, ["A"])).toMatchObject({ correct: false, score: 0 });
  });

  it("gives select-all partial credit with +/- scoring but marks it right only on an exact match", () => {
    expect(gradeChoice(sata, ["A", "C", "E"])).toMatchObject({ correct: true, score: 1 });
    expect(gradeChoice(sata, ["A", "C"]).score).toBeCloseTo(2 / 3);
    expect(gradeChoice(sata, ["A", "C", "B"])).toMatchObject({ correct: false, score: 1 / 3 });
    expect(gradeChoice(sata, ["B", "D"]).score).toBe(0);
    expect(gradeChoice(sata, ["A", "A", " C "]).selectedIds).toEqual(["A", "C"]);
  });

  it("rejects empty or unknown answers", () => {
    expect(code(() => gradeChoice(single, []))).toBe("no_answer");
    expect(code(() => gradeChoice(single, ["Z"]))).toBe("bad_answer");
  });

  it("scores a bowtie one point per element", () => {
    expect(gradeBowtie(bowtie, { condition: "A", actions: ["B", "D"], parameters: ["E", "A"] })).toMatchObject({ correct: true, score: 1 });
    const partial = gradeBowtie(bowtie, { condition: "B", actions: ["B", "C"], parameters: ["A", "E"] });
    expect(partial).toMatchObject({ correct: false, score: 3 / 5, bowtie: { condition: "A", actions: ["B", "D"], parameters: ["A", "E"] } });
    expect(partial.selectedIds).toEqual(["condition:B", "actions:B", "actions:C", "parameters:A", "parameters:E"]);
  });

  it("requires a complete bowtie", () => {
    expect(code(() => gradeBowtie(bowtie, { condition: "A", actions: ["B"], parameters: ["A", "E"] }))).toBe("incomplete_bowtie");
    expect(code(() => gradeBowtie(bowtie, { condition: "", actions: ["B", "D"], parameters: ["A", "E"] }))).toBe("incomplete_bowtie");
    expect(code(() => gradeBowtie(bowtie, { condition: "Q", actions: ["B", "D"], parameters: ["A", "E"] }))).toBe("bad_answer");
  });
});

describe("practice views", () => {
  const row = (item_type: PracticeRow["item_type"], payload: PracticeRow["payload"], origin: string | null = null): PracticeRow => ({
    id: "p1",
    stone_id: "s1",
    item_type,
    origin_question_id: origin,
    payload,
  });

  it("never sends answers or rationales to the phone", () => {
    const views = [toPracticeView(row("lesson_mcq", single)), toPracticeView(row("sata", sata, "q1")), toPracticeView(row("ngn_mini_bowtie", bowtie))];
    const text = JSON.stringify(views);
    expect(text).not.toMatch(/correct|rationale|scope/);
    expect(views.map((v) => [v.type, v.origin])).toEqual([
      ["mcq", "lesson"],
      ["sata", "uworld_twin"],
      ["bowtie", "lesson"],
    ]);
    expect(views[2]).toMatchObject({ actions: { pick: 2 }, parameters: { pick: 2 }, condition: { pick: 1 } });
  });
});

describe("lesson score", () => {
  it("uses each question's latest attempt and counts unanswered ones as missed", () => {
    const attempts = [
      { practice_item_id: "a", is_correct: false, answered_at: "2026-10-18T10:00:00Z" },
      { practice_item_id: "a", is_correct: true, answered_at: "2026-10-18T10:05:00Z" },
      { practice_item_id: "b", is_correct: true, answered_at: "2026-10-18T10:01:00Z" },
      { practice_item_id: "other", is_correct: true, answered_at: "2026-10-18T10:01:00Z" },
    ];
    expect(lessonScore(["a", "b", "c"], attempts)).toEqual({ answered: 2, score: 2 / 3 });
    expect(lessonScore(["a", "b"], attempts)).toEqual({ answered: 2, score: 1 });
    expect(lessonScore(["x"], attempts)).toEqual({ answered: 0, score: 0 });
  });
});

describe("Quick Play picks", () => {
  it("toggles picks and drops the oldest past the limit", () => {
    expect(togglePick([], "A", 1)).toEqual(["A"]);
    expect(togglePick(["A"], "B", 1)).toEqual(["B"]);
    expect(togglePick(["A", "B"], "C", 2)).toEqual(["B", "C"]);
    expect(togglePick(["A", "B"], "A", 2)).toEqual(["B"]);
  });
});
