import { describe, expect, it } from "vitest";
import type { NgnSet } from "@/lib/server/ai-schemas";
import { chooseNext, estimateAbility, itemDifficulty, stopReason, verdictFor } from "@/lib/server/exams";
import { drugNameKey, tidyDrugCard } from "@/lib/server/drug-cards";
import { tidyCloze, tidyHighlight, tidyMatrix, tidyNgnSet, tidyOrdered, tidyRoundQuestions } from "@/lib/server/ngn";
import { grade, gradeCloze, gradeMatrix, gradeOrdered, shuffledAway, tidyOptionRationales, toPracticeView, type PracticeRow } from "@/lib/server/practice";
import { attemptBody, EMPTY_ANSWERS, isAnswerReady, moveItem, splitCloze } from "@/lib/quick-play";

const choice = (ids: string[]) => ids.map((id) => ({ id, text: `Text ${id}` }));

const set: NgnSet = {
  matrix: {
    stem: "Client on digoxin. For each finding, is it expected or should it be reported?",
    columns: choice(["A", "B"]),
    rows: choice(["R1", "R2", "R3"]),
    answers: [
      { row: "R1", column: "A" },
      { row: "R2", column: "B" },
      { row: "R3", column: "B" },
    ],
    rationale: "Nausea and vision changes suggest toxicity.",
    ngn_step_id: "recognize_cues",
  },
  cloze: {
    stem: "Complete the sentence.",
    text: "The client is most likely experiencing {{1}} as shown by {{2}}.",
    blanks: [
      { id: "1", options: choice(["A", "B", "C"]), correct_option_id: "A" },
      { id: "2", options: choice(["A", "B", "C"]), correct_option_id: "C" },
    ],
    rationale: "r",
    ngn_step_id: "analyze_cues",
  },
  highlight: { stem: "Which findings need follow-up?", segments: choice(["S1", "S2", "S3", "S4", "S5"]), correct_ids: ["S2", "S4"], rationale: "r", ngn_step_id: "recognize_cues" },
  ordered: { stem: "Order the steps.", items: choice(["A", "B", "C", "D"]), correct_order: ["C", "A", "D", "B"], rationale: "r", ngn_step_id: "take_action" },
};

describe("NGN item checks", () => {
  it("keeps a well-formed set", () => {
    expect(tidyNgnSet(set).map((i) => i.item_type)).toEqual(["ngn_matrix", "ngn_cloze", "ngn_highlight", "ngn_ordered"]);
  });

  it("drops a matrix with a row left unanswered or a made-up column", () => {
    expect(tidyMatrix({ ...set.matrix, answers: set.matrix.answers.slice(0, 2) })).toBeNull();
    expect(tidyMatrix({ ...set.matrix, answers: [...set.matrix.answers.slice(0, 2), { row: "R3", column: "Z" }] })).toBeNull();
  });

  it("drops a cloze whose markers and blanks don't line up", () => {
    expect(tidyCloze({ ...set.cloze, text: "Only {{1}} here." })).toBeNull();
    expect(tidyCloze({ ...set.cloze, text: "{{1}} and {{1}} and {{2}}" })).toBeNull();
    expect(tidyCloze({ ...set.cloze, blanks: [set.cloze.blanks[0], { ...set.cloze.blanks[1], correct_option_id: "Z" }] })).toBeNull();
  });

  it("drops a highlight where everything or nothing is right", () => {
    expect(tidyHighlight({ ...set.highlight, correct_ids: [] })).toBeNull();
    expect(tidyHighlight({ ...set.highlight, correct_ids: ["S1", "S2", "S3", "S4", "S5"] })).toBeNull();
  });

  it("drops an ordered item whose order isn't every step once", () => {
    expect(tidyOrdered({ ...set.ordered, correct_order: ["C", "A", "D"] })).toBeNull();
    expect(tidyOrdered({ ...set.ordered, correct_order: ["C", "A", "A", "B"] })).toBeNull();
  });

  it("keeps round questions with a real answer and drops ones where every option is right", () => {
    const q = { stem: "Q?", options: choice(["A", "B", "C", "D"]), correct_option_ids: ["B"], rationale: "r", option_rationales: [{ option_id: "B", why: "Because." }, { option_id: "Z", why: "No such option." }], ngn_step_id: "take_action" as const };
    const kept = tidyRoundQuestions([q, { ...q, correct_option_ids: ["A", "B", "C", "D"] }, { ...q, options: choice(["A", "B"]) }]);
    expect(kept).toHaveLength(1);
    expect(kept[0].option_rationales).toEqual([{ id: "B", why: "Because." }]);
  });
});

describe("grading the new item types", () => {
  const rows = tidyNgnSet(set);
  const row = (type: string): PracticeRow => {
    const r = rows.find((x) => x.item_type === type)!;
    return { id: `id-${type}`, stone_id: "s", item_type: r.item_type, origin_question_id: null, payload: r.payload as PracticeRow["payload"] };
  };

  it("scores a matrix per row and needs every row", () => {
    const m = row("ngn_matrix").payload as Parameters<typeof gradeMatrix>[0];
    expect(gradeMatrix(m, { R1: "A", R2: "B", R3: "A" })).toMatchObject({ correct: false, score: 2 / 3 });
    expect(gradeMatrix(m, { R1: "A", R2: "B", R3: "B" })).toMatchObject({ correct: true, score: 1 });
    expect(() => gradeMatrix(m, { R1: "A" })).toThrow(/every row/);
  });

  it("scores a cloze per blank", () => {
    const c = row("ngn_cloze").payload as Parameters<typeof gradeCloze>[0];
    expect(gradeCloze(c, { "1": "A", "2": "B" })).toMatchObject({ correct: false, score: 0.5 });
    expect(() => gradeCloze(c, { "1": "Q", "2": "C" })).toThrow();
  });

  it("scores a highlight with +/- credit", () => {
    const g = grade(row("ngn_highlight"), { selected: ["S2", "S3"] });
    expect(g.correct).toBe(false);
    expect(g.score).toBe(0);
    expect(grade(row("ngn_highlight"), { selected: ["S2", "S4"] }).correct).toBe(true);
  });

  it("scores an ordered item all or nothing and needs every step", () => {
    const o = row("ngn_ordered").payload as Parameters<typeof gradeOrdered>[0];
    expect(gradeOrdered(o, ["C", "A", "D", "B"])).toMatchObject({ correct: true, score: 1 });
    expect(gradeOrdered(o, ["A", "C", "D", "B"])).toMatchObject({ correct: false, score: 0 });
    expect(() => gradeOrdered(o, ["C", "A", "D"])).toThrow(/every step/);
  });

  it("never sends answers to the phone, and never shows an ordered item already in order", () => {
    for (const type of ["ngn_matrix", "ngn_cloze", "ngn_highlight", "ngn_ordered"]) {
      const view = JSON.stringify(toPracticeView(row(type)));
      expect(view).not.toMatch(/answers|correct|rationale/);
    }
    for (let i = 0; i < 50; i++) {
      const shuffled = shuffledAway(choice(["A", "B", "C"]), ["A", "B", "C"], `seed-${i}`);
      expect(shuffled.map((c) => c.id)).not.toEqual(["A", "B", "C"]);
      expect(shuffledAway(choice(["A", "B", "C"]), ["A", "B", "C"], `seed-${i}`)).toEqual(shuffled);
    }
  });

  it("passes option rationales through grading, in option order", () => {
    const options = choice(["A", "B", "C", "D"]);
    const why = tidyOptionRationales([{ option_id: "C", why: "c" }, { option_id: "A", why: "  a  " }], options);
    expect(why).toEqual([{ id: "A", why: "a" }, { id: "C", why: "c" }]);
    const g = grade({ id: "x", stone_id: "s", item_type: "lesson_mcq", origin_question_id: null, payload: { stem: "s", options, correct_option_ids: ["A"], rationale: "r", option_rationales: why } }, { selected: ["A"] });
    expect(g.optionRationales).toEqual(why);
  });
});

describe("answer state on the phone", () => {
  it("splits cloze text into text and blanks", () => {
    expect(splitCloze("A {{1}} b {{ 2 }}.")).toEqual([
      { kind: "text", text: "A " },
      { kind: "blank", id: "1" },
      { kind: "text", text: " b " },
      { kind: "blank", id: "2" },
      { kind: "text", text: "." },
    ]);
  });

  it("moves ordered steps and stays in bounds", () => {
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  });

  it("knows when each type is ready and builds its answer", () => {
    const matrix = { id: "m", type: "matrix" as const, origin: "lesson" as const, stem: "", columns: choice(["A", "B"]), rows: choice(["R1", "R2"]) };
    const answers = { ...EMPTY_ANSWERS, matrix: { m: { R1: "A" } } };
    expect(isAnswerReady(matrix, answers)).toBe(false);
    const full = { ...answers, matrix: { m: { R1: "A", R2: "B" } } };
    expect(isAnswerReady(matrix, full)).toBe(true);
    expect(attemptBody(matrix, full)).toEqual({ itemId: "m", matrix: { R1: "A", R2: "B" } });
    const ordered = { id: "o", type: "ordered" as const, origin: "lesson" as const, stem: "", items: choice(["B", "A"]) };
    expect(attemptBody(ordered, EMPTY_ANSWERS)).toEqual({ itemId: "o", order: ["B", "A"] });
  });
});

describe("adaptive exams", () => {
  it("raises the estimate after right answers and lowers it after wrong ones", () => {
    const right = estimateAbility(Array.from({ length: 20 }, () => ({ difficulty: 0, score: 1 })));
    const wrong = estimateAbility(Array.from({ length: 20 }, () => ({ difficulty: 0, score: 0 })));
    expect(right.theta).toBeGreaterThan(1);
    expect(wrong.theta).toBeLessThan(-1);
    expect(estimateAbility([]).theta).toBeCloseTo(0, 5);
    expect(estimateAbility([]).se).toBeCloseTo(1, 1);
    expect(right.se).toBeLessThan(1);
  });

  it("stops at the minimum only when confident, and always at the limits", () => {
    const base = { answered: 20, min: 15, max: 40, elapsedMs: 0, limitMs: 3600000, remaining: 50 };
    expect(stopReason({ ...base, theta: 1.5, se: 0.4 })).toBe("confident_above");
    expect(stopReason({ ...base, theta: -1.5, se: 0.4 })).toBe("confident_below");
    expect(stopReason({ ...base, theta: 0.3, se: 0.4 })).toBeNull();
    expect(stopReason({ ...base, answered: 10, theta: 2, se: 0.3 })).toBeNull();
    expect(stopReason({ ...base, answered: 40, theta: 0, se: 1 })).toBe("max_items");
    expect(stopReason({ ...base, elapsedMs: 3600000, theta: 0, se: 1 })).toBe("time");
    expect(stopReason({ ...base, remaining: 0, theta: 0, se: 1 })).toBe("out_of_items");
  });

  it("serves the client need furthest behind its share, near the estimate", () => {
    const candidates = [
      { id: "p-easy", clientNeed: "pharm", difficulty: -1 },
      { id: "p-mid", clientNeed: "pharm", difficulty: 0.1 },
      { id: "s-mid", clientNeed: "safety", difficulty: 0 },
    ];
    const weights = { pharm: 0.13, safety: 0.13 };
    expect(chooseNext(candidates, { pharm: 3, safety: 0 }, weights, 0, () => 0)?.id).toBe("s-mid");
    expect(chooseNext(candidates, { pharm: 0, safety: 3 }, weights, 0, () => 0)?.id).toBe("p-mid");
    expect(chooseNext([], {}, weights, 0)).toBeNull();
  });

  it("treats missed questions as harder and known ones as easier", () => {
    expect(itemDifficulty("mcq", { missed: 1, right: 0 })).toBeGreaterThan(itemDifficulty("mcq", { missed: 0, right: 0 }));
    expect(itemDifficulty("sata", { missed: 0, right: 2 })).toBeLessThan(itemDifficulty("sata", { missed: 0, right: 0 }));
  });

  it("always says it's practice, not a prediction", () => {
    for (const reason of ["confident_above", "confident_below", "max_items", null] as const) {
      expect(verdictFor(reason, 0.5, 20)).toMatch(/not a prediction/);
    }
  });
});

describe("drug cards", () => {
  it("keys names without brands, case or punctuation", () => {
    expect(drugNameKey("Digoxin (Lanoxin)")).toBe("digoxin");
    expect(drugNameKey("  Metoprolol tartrate ")).toBe("metoprolol tartrate");
  });

  it("marks a field from the student's sources only when its quote is real", () => {
    const field = (text: string, quote = "", source = -1) => ({ text, quote, source });
    const sources = [{ id: "p", kind: "textbook" as const, label: "Pharm, p. 40", text: "Hold digoxin if the apical pulse is below 60 beats per minute." }];
    const { card, refs } = tidyDrugCard(
      {
        is_medication: true,
        name: "Digoxin (Lanoxin)",
        drug_class: field("Cardiac glycoside"),
        action: field("Slows and strengthens the heartbeat", "invented words that are not there", 0),
        uses: field("Heart failure, atrial fibrillation"),
        side_effects: field("Toxicity: nausea, vision changes"),
        nursing: field("Take the apical pulse for a full minute"),
        teaching: field("Report nausea or yellow vision"),
        hold_parameters: field("Hold if apical pulse is under 60", "apical pulse is below 60 beats per minute", 0),
        questions: [],
      },
      sources,
    );
    expect(card.hold_parameters.fromSources).toBe(true);
    expect(card.action.fromSources).toBe(false);
    expect(card.drug_class.fromSources).toBe(false);
    expect(refs).toEqual([{ kind: "textbook", label: "Pharm, p. 40", quote: "apical pulse is below 60 beats per minute" }]);
  });
});
