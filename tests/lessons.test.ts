import { describe, expect, it } from "vitest";
import type { Lesson } from "@/lib/server/ai-schemas";
import {
  clampBullets,
  fallbackPearls,
  isValidBowtie,
  lessonCaptions,
  lessonCards,
  lessonFingerprint,
  normalizeForMatch,
  tidyLesson,
  verifyPearls,
  type LessonNote,
  type StoneContext,
  type StoredLesson,
} from "@/lib/server/lessons";

const options = ["A", "B", "C", "D", "E"].map((id) => ({ id, text: `Option ${id}` }));
const bowtie = {
  scenario: "A client on digoxin feels nauseated.",
  condition: { prompt: "Most likely?", options: options.slice(0, 4), correct_option_id: "B" },
  actions: { prompt: "Pick 2", options, correct_option_ids: ["A", "C"] },
  parameters: { prompt: "Pick 2", options, correct_option_ids: ["D", "E"] },
  rationale: "Toxicity signs.",
};

const notes: LessonNote[] = [
  { id: "n1", title: "Cardiac", notebook: "Pharm", content: "**Digoxin**\nHold if apical pulse < 60. Remember: *yellow-green halos* = toxicity!", isPearl: true },
  { id: "n2", title: "Cardiac", notebook: null, content: "# Heart failure\n- Daily weight, same scale, same time.\n- Report a gain of 2 lb in a day.", isPearl: false },
];

function draft(overrides: Partial<Lesson> = {}): Lesson {
  return {
    eli10: { title: "A tired pump", analogy: "Your heart is a pump. When it gets tired, water backs up." },
    lpn_core: [
      { title: "What's happening", bullets: ["The heart pumps weakly.", "Fluid backs up.", "Lungs get wet.", "A fourth bullet that must go."] },
      { title: "Data to collect", bullets: ["Crackles", "Weight gain", ""] },
      { title: "LPN actions", bullets: ["Give ordered diuretics", "Report changes to the RN"] },
      { title: "Extra card", bullets: ["Should be dropped"] },
    ],
    exam_alert: { focus: "early_vs_late", title: "Early vs late", bullets: ["Early: restlessness", "Late: cyanosis"] },
    notebook_title: "Your digoxin pearls",
    notebook_pearls: [
      { note_index: 0, quote: "Hold if apical pulse < 60." },
      { note_index: 0, quote: "Remember: yellow-green halos = toxicity" },
      { note_index: 1, quote: "Give digoxin with grapefruit juice" },
      { note_index: 7, quote: "Daily weight, same scale, same time." },
    ],
    quiz: [
      { stem: "Pulse is 54. What do you do?", options: options.slice(0, 4), correct_option_ids: ["B"], rationale: "Hold it.", ngn_step_id: "take_action" },
      { stem: "Broken question", options: options.slice(0, 4), correct_option_ids: ["Z"], rationale: "", ngn_step_id: "take_action" },
      { stem: "Which are toxicity signs?", options, correct_option_ids: ["A", "D"], rationale: "Both.", ngn_step_id: "recognize_cues" },
    ],
    checkpoint: bowtie,
    ...overrides,
  };
}

describe("tidyLesson", () => {
  it("caps every card at 3 bullets and the LPN Core at 3 sub-cards", () => {
    const lesson = tidyLesson(draft(), notes);
    expect(lesson.lpnCore).toHaveLength(3);
    expect(lesson.lpnCore[0].bullets).toHaveLength(3);
    expect(lesson.lpnCore[1].bullets).toEqual(["Crackles", "Weight gain"]);
    expect(lesson.examAlert.bullets).toEqual(["Early: restlessness", "Late: cyanosis"]);
  });

  it("keeps only quotes that really appear in the cited note", () => {
    const lesson = tidyLesson(draft(), notes);
    expect(lesson.notebook).toEqual({
      title: "Your digoxin pearls",
      pearls: ["Hold if apical pulse < 60.", "Remember: yellow-green halos = toxicity"],
    });
  });

  it("falls back to the student's own lines when no quote checks out", () => {
    const lesson = tidyLesson(draft({ notebook_pearls: [{ note_index: 0, quote: "Something made up entirely" }] }), notes);
    expect(lesson.notebook?.pearls[0]).toBe("Hold if apical pulse < 60. Remember: yellow-green halos = toxicity!");
    expect(lesson.notebook?.pearls).toContain("Daily weight, same scale, same time.");
  });

  it("has no notebook card when there are no notes", () => {
    expect(tidyLesson(draft(), []).notebook).toBeNull();
  });

  it("drops broken questions and keeps two at most", () => {
    const lesson = tidyLesson(draft(), notes);
    expect(lesson.quiz.map((q) => q.stem)).toEqual(["Pulse is 54. What do you do?", "Which are toxicity signs?"]);
    expect(lesson.checkpoint).toEqual(bowtie);
  });

  it("drops a bowtie whose answers don't match its options", () => {
    const broken = { ...bowtie, actions: { ...bowtie.actions, correct_option_ids: ["A", "Q"] } };
    expect(isValidBowtie(broken)).toBe(false);
    expect(tidyLesson(draft({ checkpoint: broken }), notes).checkpoint).toBeNull();
  });

  it("refuses a lesson with no teaching content", () => {
    expect(() => tidyLesson(draft({ lpn_core: [{ title: "Empty", bullets: [" "] }] }), notes)).toThrow(/incomplete/);
  });
});

describe("quote matching", () => {
  it("ignores markdown, smart quotes, case and spacing", () => {
    expect(normalizeForMatch("**Hold** if  apical\npulse “low” now.")).toBe('hold if apical pulse "low" now');
    expect(verifyPearls([{ note_index: 0, quote: "REMEMBER: Yellow-green  halos" }], notes)).toEqual(["REMEMBER: Yellow-green halos"]);
    expect(verifyPearls([{ note_index: 0, quote: "short" }], notes)).toEqual([]);
  });

  it("builds fallback pearls from pearl notes first", () => {
    expect(fallbackPearls(notes)[0]).toMatch(/^Hold if apical pulse/);
    expect(clampBullets(["a", "a", "b", "c", "d"])).toEqual(["a", "b", "c"]);
  });
});

describe("lesson cards", () => {
  const stored: StoredLesson = {
    version: 1,
    eli10: { title: "A tired pump", body: "Body" },
    lpnCore: [
      { title: "One", bullets: ["a"] },
      { title: "Two", bullets: ["b"] },
    ],
    examAlert: { title: "Alert", bullets: ["c"], focus: "exam_trap" },
    notebook: null,
    practiceItemIds: ["p1", "p2", "p3"],
  };

  it("lays the deck out in story order with an invitation when there are no notes", () => {
    const cards = lessonCards(stored, 3);
    expect(cards.map((c) => c.kind)).toEqual(["eli10", "lpn_core", "lpn_core", "exam_alert", "notebooklm", "quick_play"]);
    expect(cards[4].title).toBe("Your notes go here");
    expect(cards[5].body).toBe("3 questions. Tap to answer.");
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
  });

  it("shows the student's pearls when there are notes", () => {
    const cards = lessonCards({ ...stored, notebook: { title: "Pearls", pearls: ["x", "y"] } }, 1);
    expect(cards[4]).toMatchObject({ title: "Pearls", bullets: ["x", "y"] });
    expect(cards[5].body).toBe("1 question. Tap to answer.");
  });
});

describe("lessonFingerprint", () => {
  const context: StoneContext = {
    stone: { id: "s", title: "Digoxin safety", summary: "Check the pulse.", status: "ready" },
    chapter: { number: "2", title: "Cardiac" },
    unitTitle: "Unit 2",
    book: { title: "Book", courseId: "pharmacology" },
    tags: [{ clientNeedId: "pharm", clientNeed: "Pharm", lpnFocus: "", hesiDomain: "Pharmacology", hesiHint: "", relevance: 1 }],
    notes,
    passages: [{ id: "p1", pages: "p. 12", pageFrom: 12, pageTo: 12, heading: "Digoxin", content: "Take the apical pulse for a full minute." }],
    questions: [{ id: "q1", topic: "digoxin", coreTakeaway: "Hold it", traps: [], missed: true }],
    twins: [],
  };

  it("stays the same for the same sources and changes when any source changes", () => {
    const base = lessonFingerprint(context, "claude-sonnet-5-5");
    expect(lessonFingerprint({ ...context, notes: [...notes].reverse() }, "claude-sonnet-5-5")).toBe(base);
    expect(lessonFingerprint(context, "other-model")).not.toBe(base);
    expect(lessonFingerprint({ ...context, notes: [{ ...notes[0], content: "edited" }, notes[1]] }, "claude-sonnet-5-5")).not.toBe(base);
    expect(lessonFingerprint({ ...context, questions: [] }, "claude-sonnet-5-5")).not.toBe(base);
    expect(lessonFingerprint({ ...context, passages: [] }, "claude-sonnet-5-5")).not.toBe(base);
    expect(lessonFingerprint({ ...context, notes: [{ ...notes[0], notebook: "Moved" }, notes[1]] }, "claude-sonnet-5-5")).not.toBe(base);
    expect(lessonFingerprint({ ...context, stone: { ...context.stone, status: "mastered" } }, "claude-sonnet-5-5")).toBe(base);
  });
});

describe("lessonCaptions", () => {
  const book = { title: "Foundations", courseId: "fundamentals" };
  const passage = (pageFrom: number, pageTo: number) => ({ id: `p${pageFrom}`, pages: "", pageFrom, pageTo, heading: "", content: "x" });

  it("names the book pages behind the LPN Core cards", () => {
    expect(lessonCaptions({ book, notes: [], passages: [passage(12, 12)] }).core).toBe("Foundations, p. 12");
    expect(lessonCaptions({ book, notes: [], passages: [passage(14, 15), passage(12, 12)] }).core).toBe("Foundations, pp. 12, 14-15");
    expect(lessonCaptions({ book, notes: [], passages: [1, 3, 5, 7, 9].map((n) => passage(n, n)) }).core).toBe("Foundations, pp. 1, 3, 5 and 2 more");
  });

  it("names the notebook and source behind the pearls", () => {
    expect(lessonCaptions({ book, notes: [notes[0]], passages: [] }).notebook).toBe("From Pharm: Cardiac");
    expect(lessonCaptions({ book, notes: [{ ...notes[0], notebook: null }], passages: [] }).notebook).toBe("From your notes: Cardiac");
    expect(lessonCaptions({ book, notes: [notes[0], { ...notes[1], title: "HF" }], passages: [] }).notebook).toBe("From Pharm: 2 sources");
  });

  it("adds nothing when there are no sources", () => {
    expect(lessonCaptions({ book, notes: [], passages: [] })).toEqual({});
  });
});
