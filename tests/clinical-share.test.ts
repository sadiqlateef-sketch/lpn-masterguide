import { describe, expect, it } from "vitest";
import type { LessonCardView, LessonView, PracticeView } from "@/lib/api-types";
import { CLIENT_NEED_IDS } from "@/lib/blueprint-ids";
import { findIdentifier, tidyProblems } from "@/lib/server/clinical";
import type { PracticeRow } from "@/lib/server/practice";
import { isShareToken, newShareToken, sharedCards, sharedItems, sharedPayload } from "@/lib/server/share";
import { findSkill, SKILLS } from "@/lib/server/skills/bank";
import { lessonTracks, MAX_PLAYLIST_QUESTIONS, playlistQuestions } from "@/lib/ui/audio";

describe("clinical identifiers", () => {
  it.each([
    ["Mrs. Lopez in 412 has heart failure", "a name"],
    ["Client in room 12 with COPD", "a room or bed number"],
    ["bed 4, CHF", "a room or bed number"],
    ["DOB on the chart", "a birth date or record number"],
    ["MRN is on the band", "a birth date or record number"],
    ["Admitted 3/14/2026 with pneumonia", "a date"],
    ["Record 12345678", "a long number"],
    ["Family at 555-123-4567", "a phone number"],
    ["Email them at someone@example.com", "an email address"],
    ["92 year old with a hip fracture", "an age over 89"],
  ])("finds the identifier in %j", (text, what) => {
    expect(findIdentifier(text)).toBe(what);
  });

  it.each(["Older adult with heart failure and 2+ ankle edema", "Type 2 diabetes, on metformin 500 mg twice a day", "78 year old after a hip replacement", "Furosemide 40 mg PO daily, K+ 3.2"])(
    "lets clinical details through: %j",
    (text) => {
      expect(findIdentifier(text)).toBeNull();
    },
  );
});

describe("care plan tidying", () => {
  it("trims, caps and drops empty problems and actions", () => {
    const long = "x".repeat(500);
    const problems = tidyProblems([
      {
        problem: "  Risk   for falls ",
        related_to: "weakness",
        evidence: ["unsteady gait", "uses walker", "on a diuretic", "fourth finding"],
        goal: long,
        interventions: [
          { action: "Keep the call light in reach", why: "So they ask for help" },
          { action: "  ", why: "empty" },
          { action: "Bed in low position", why: "Shorter fall" },
          { action: "Nonskid socks", why: "Grip" },
          { action: "Hourly rounding", why: "Needs met" },
          { action: "A fifth one", why: "Too many" },
        ],
        report_to_rn: ["a fall"],
        evaluation: "No falls this shift",
      },
      { problem: "", related_to: "", evidence: [], goal: "", interventions: [{ action: "x", why: "" }], report_to_rn: [], evaluation: "" },
      { problem: "No actions", related_to: "", evidence: [], goal: "", interventions: [], report_to_rn: [], evaluation: "" },
    ]);
    expect(problems).toHaveLength(1);
    const [p] = problems;
    expect(p.problem).toBe("Risk for falls");
    expect(p.evidence).toHaveLength(3);
    expect(p.goal.length).toBe(400);
    expect(p.interventions.map((i) => i.action)).toEqual(["Keep the call light in reach", "Bed in low position", "Nonskid socks", "Hourly rounding"]);
  });
});

describe("share links", () => {
  it("makes long random tokens and accepts only that shape", () => {
    const a = newShareToken();
    const b = newShareToken();
    expect(a).not.toBe(b);
    expect(isShareToken(a)).toBe(true);
    expect(isShareToken("short")).toBe(false);
    expect(isShareToken(`${a.slice(0, 40)}/../x`)).toBe(false);
  });

  it("leaves the notebook card, Quick Play and every caption out of a shared lesson", () => {
    const cards: LessonCardView[] = [
      { id: "eli10", kind: "eli10", title: "Plainly", body: "Body", caption: "From Pharm notebook: my notes" },
      { id: "core", kind: "lpn_core", title: "Core", bullets: ["one", "two"], caption: "Foundations, pp. 4-5" },
      { id: "nb", kind: "notebooklm", title: "Your notes", body: "Private notes" },
      { id: "qp", kind: "quick_play", title: "Quick play" },
    ];
    const shared = sharedCards(cards);
    expect(shared).toEqual([
      { kind: "eli10", title: "Plainly", body: "Body" },
      { kind: "lpn_core", title: "Core", bullets: ["one", "two"] },
    ]);
    expect(JSON.stringify(shared)).not.toMatch(/notebook|Private|pp\./i);
  });

  it("copies only the fields a question needs", () => {
    const payload = sharedPayload("lesson_mcq", {
      stem: "Which first?",
      options: [{ id: "A", text: "a" }],
      correct_option_ids: ["A"],
      rationale: "Because.",
      source_quote: "copied from my notes",
      notebook: "Pharm",
    } as never) as unknown as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["correct_option_ids", "options", "rationale", "stem"]);
  });

  it("keeps questions written from a missed question bank item private and renames the rest", () => {
    const mcq = { stem: "s", options: [], correct_option_ids: [], rationale: "r" };
    const rows: PracticeRow[] = [
      { id: "11111111-1111-4111-8111-111111111111", stone_id: "s", item_type: "lesson_mcq", origin_question_id: null, payload: mcq },
      { id: "22222222-2222-4222-8222-222222222222", stone_id: "s", item_type: "lesson_mcq", origin_question_id: "uw-1", payload: mcq },
      { id: "33333333-3333-4333-8333-333333333333", stone_id: "s", item_type: "sata", origin_question_id: null, payload: mcq },
    ];
    const items = sharedItems(rows);
    expect(items.map((i) => i.id)).toEqual(["q1", "q2"]);
    expect(JSON.stringify(items)).not.toMatch(/1111|3333|uw-1/);
  });

  it("caps a shared set at 40 questions", () => {
    const rows: PracticeRow[] = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      stone_id: "s",
      item_type: "lesson_mcq",
      origin_question_id: null,
      payload: { stem: "s", options: [], correct_option_ids: [], rationale: "r" },
    }));
    expect(sharedItems(rows)).toHaveLength(40);
  });
});

describe("skills bank", () => {
  it("has well-formed skills, each ending with two NCLEX-style questions", () => {
    expect(SKILLS.length).toBeGreaterThanOrEqual(10);
    const ids = new Set<string>();
    for (const skill of SKILLS) {
      expect(skill.id).toMatch(/^[a-z0-9_]{2,40}$/);
      expect(ids.has(skill.id)).toBe(false);
      ids.add(skill.id);
      expect(findSkill(skill.id)).toBe(skill);
      expect(skill.steps.length).toBeGreaterThanOrEqual(5);
      expect(skill.steps.some((s) => s.critical)).toBe(true);
      for (const step of skill.steps) {
        expect(step.text.trim()).not.toBe("");
        expect(step.why.trim()).not.toBe("");
      }
      expect(skill.questions).toHaveLength(2);
      const keys = new Set(skill.questions.map((q) => q.key));
      expect(keys.size).toBe(2);
      for (const q of skill.questions) {
        expect(q.options).toHaveLength(4);
        const optionIds = q.options.map((o) => o.id);
        expect(q.correct_option_ids.length).toBeGreaterThan(0);
        for (const c of q.correct_option_ids) expect(optionIds).toContain(c);
        expect(q.option_rationales?.map((r) => r.id)).toEqual(optionIds);
        expect(CLIENT_NEED_IDS).toContain(q.client_need_id);
        expect(q.rationale.trim()).not.toBe("");
      }
    }
  });

  it("finds nothing for an unknown skill", () => {
    expect(findSkill("not_a_skill")).toBeUndefined();
  });
});

describe("audio playlist", () => {
  const q = (id: string): PracticeView => ({ id, type: "mcq", origin: "lesson", stem: "s", options: [] });
  const lesson = (n: number, practice: PracticeView[]): LessonView => ({
    stoneId: `s${n}`,
    stoneTitle: `Stone ${n}`,
    cached: true,
    practice,
    cards: [
      { id: "a", kind: "eli10", title: "Plainly", body: "The heart pumps", bullets: ["one", "two", "three", "four"] },
      { id: "b", kind: "lpn_core", title: "Core" },
      { id: "c", kind: "quick_play", title: "Quick play" },
    ],
  });

  it("reads each card but Quick Play, with up to three bullets", () => {
    const tracks = lessonTracks(lesson(1, []));
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toEqual({ stoneTitle: "Stone 1", title: "Plainly", text: "Plainly. The heart pumps. one. two. three" });
    expect(tracks[1].text).toBe("Core");
  });

  it("ends with two questions from each lesson, six at most", () => {
    const lessons = [1, 2, 3, 4].map((n) => lesson(n, [q(`${n}a`), q(`${n}b`), q(`${n}c`)]));
    const ids = playlistQuestions(lessons).map((x) => x.id);
    expect(ids).toEqual(["1a", "1b", "2a", "2b", "3a", "3b"]);
    expect(ids.length).toBe(MAX_PLAYLIST_QUESTIONS);
  });
});
