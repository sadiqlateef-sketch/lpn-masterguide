import { describe, expect, it } from "vitest";
import type { MedMatchRaw, TriageRaw } from "@/lib/server/ai-schemas";
import { ISOLATION_CARDS, LABS, PPE_DOFFING, PPE_DONNING, SCOPE_CARDS } from "@/lib/server/games/bank";
import { GAME_INFO, gradeRound, isolationRound, labRound, medMatchRound, medMathGameRound, ppeRound, scopeRound, triageRound } from "@/lib/server/games/build";
import { checkMedMath, medMathRound, parseAnswer, round, type MedMathProblem } from "@/lib/server/games/medmath";
import { rankForEnding } from "@/lib/server/games/rounds";
import { GAME_IDS } from "@/lib/api-types";
import { CLIENT_NEED_IDS } from "@/lib/blueprint-ids";

// A seeded random number generator, so rounds are repeatable in tests.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("med math", () => {
  it("reads typed answers with units, fractions and commas", () => {
    expect(parseAnswer("1.5")).toBe(1.5);
    expect(parseAnswer("1 1/2 tablets")).toBe(1.5);
    expect(parseAnswer("3/4")).toBe(0.75);
    expect(parseAnswer("1,000 mg")).toBe(1000);
    expect(parseAnswer("12 mL")).toBe(12);
    expect(parseAnswer(".5")).toBe(0.5);
    expect(parseAnswer("abc")).toBeNull();
    expect(parseAnswer("1/0")).toBeNull();
    expect(parseAnswer("1.2.3")).toBeNull();
  });

  it("rounds without floating-point noise", () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(20.833333, 0)).toBe(21);
  });

  it("builds problems whose own answers check out, for many seeds", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const problems = medMathRound(seeded(seed));
      expect(problems).toHaveLength(5);
      expect(new Set(problems.map((p) => p.id)).size).toBe(5);
      for (const p of problems) {
        expect(Number.isFinite(p.answer)).toBe(true);
        expect(p.answer).toBeGreaterThan(0);
        expect(checkMedMath(p, String(p.answer)).correct).toBe(true);
        expect(p.steps.length).toBeGreaterThan(0);
      }
    }
  });

  it("gets a drip rate right only when rounded to the whole drop", () => {
    const drip: MedMathProblem = { id: "P1", kind: "drip", text: "", unit: "gtt/min", answer: 21, tolerance: 0.5, steps: [] };
    expect(checkMedMath(drip, "21").correct).toBe(true);
    expect(checkMedMath(drip, "20").correct).toBe(false);
    expect(checkMedMath(drip, "").correct).toBe(false);
  });

  it("coaches safe number writing", () => {
    const p: MedMathProblem = { id: "P1", kind: "convert", text: "", unit: "mg", answer: 0.5, tolerance: 0.001, steps: [] };
    expect(checkMedMath(p, ".5")).toEqual({ correct: true, note: expect.stringContaining("leading zero") });
    const q: MedMathProblem = { ...p, answer: 5 };
    expect(checkMedMath(q, "5.0").note).toMatch(/trailing zeros/);
    expect(checkMedMath(q, "5").note).toBeNull();
  });
});

describe("fixed game banks", () => {
  it("PPE orders follow the CDC sequence", () => {
    expect(PPE_DONNING.map((s) => s.id)).toEqual(["hh", "gown", "mask", "eyes", "gloves"]);
    expect(PPE_DOFFING.map((s) => s.id)).toEqual(["gloves", "eyes", "gown", "mask", "hh"]);
  });

  it("has every precaution, role and band covered", () => {
    for (const p of ["contact", "droplet", "airborne"]) expect(ISOLATION_CARDS.filter((c) => c.precaution === p).length).toBeGreaterThanOrEqual(3);
    for (const r of ["lpn", "rn", "uap"]) expect(SCOPE_CARDS.filter((c) => c.role === r).length).toBeGreaterThanOrEqual(3);
    expect(new Set(ISOLATION_CARDS.map((c) => c.id)).size).toBe(ISOLATION_CARDS.length);
    expect(new Set(SCOPE_CARDS.map((c) => c.id)).size).toBe(SCOPE_CARDS.length);
  });

  it("keeps every lab sample inside its band", () => {
    for (const lab of LABS) {
      const [lo, hi] = lab.range.replace(/,/g, "").split(" to ").map(Number);
      for (const v of lab.samples.low) expect(v, `${lab.name} low ${v}`).toBeLessThan(lo);
      for (const v of lab.samples.normal) expect(v >= lo && v <= hi, `${lab.name} normal ${v}`).toBe(true);
      for (const v of lab.samples.high) expect(v, `${lab.name} high ${v}`).toBeGreaterThan(hi);
    }
  });

  it("maps every game to a real client need", () => {
    for (const id of GAME_IDS) expect(CLIENT_NEED_IDS).toContain(GAME_INFO[id].clientNeed);
  });
});

describe("rounds", () => {
  it("bins rounds have six cards with every bin used, and never send the answers", () => {
    for (let seed = 1; seed <= 50; seed++) {
      for (const build of [isolationRound, scopeRound, labRound]) {
        const r = build(seeded(seed));
        if (r.view.kind !== "bins" || r.key.kind !== "bins") throw new Error("expected bins");
        expect(r.view.cards).toHaveLength(6);
        expect(new Set(r.key.cards.map((c) => c.bin)).size).toBe(3);
        expect(JSON.stringify(r.view)).not.toMatch(/"bin"|why/);
      }
    }
  });

  it("grades a perfect bins answer as all right and a blank one as all wrong", () => {
    const r = isolationRound(seeded(7));
    if (r.key.kind !== "bins") throw new Error("expected bins");
    const perfect = Object.fromEntries(r.key.cards.map((c) => [c.id, c.bin]));
    expect(gradeRound(r.key, { bins: perfect }).every((i) => i.correct)).toBe(true);
    const blank = gradeRound(r.key, {});
    expect(blank.every((i) => !i.correct && i.given === null)).toBe(true);
  });

  it("grades order rounds by position", () => {
    const r = ppeRound(seeded(3));
    if (r.key.kind !== "order") throw new Error("expected order");
    expect(gradeRound(r.key, { order: r.key.correct }).filter((i) => i.correct)).toHaveLength(5);
    const swapped = [...r.key.correct];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(gradeRound(r.key, { order: swapped }).filter((i) => i.correct)).toHaveLength(3);
  });

  it("grades med math with worked steps", () => {
    const r = medMathGameRound(seeded(11));
    if (r.key.kind !== "calc") throw new Error("expected calc");
    const answers = Object.fromEntries(r.key.problems.map((p) => [p.id, String(p.answer)]));
    const graded = gradeRound(r.key, { calc: answers });
    expect(graded.every((i) => i.correct && i.steps && i.steps.length > 0)).toBe(true);
    expect(r.timeLimitSeconds).toBeGreaterThan(0);
  });

  it("builds med match from unique pairs and drops repeats", () => {
    const raw: MedMatchRaw = {
      pairs: [
        { medication: "Digoxin", match: "Check apical pulse first", why: "Hold under 60.", quote: "apical pulse for one full minute", source: 0 },
        { medication: "digoxin", match: "Duplicate", why: "", quote: "", source: -1 },
        { medication: "Furosemide", match: "Loop diuretic", why: "Watch potassium.", quote: "", source: -1 },
        { medication: "Warfarin", match: "Monitor INR", why: "Goal 2 to 3.", quote: "made up words", source: 0 },
        { medication: "Heparin", match: "Monitor aPTT", why: "Antidote protamine.", quote: "", source: -1 },
        { medication: "Metoprolol", match: "Loop diuretic", why: "Repeat match", quote: "", source: -1 },
      ],
    };
    const sources = [{ id: "s", kind: "textbook" as const, label: "Pharm, p. 9", text: "Take the apical pulse for one full minute before digoxin." }];
    const r = medMatchRound(raw, sources, seeded(1));
    if (!r || r.key.kind !== "match" || r.view.kind !== "match") throw new Error("expected a match round");
    expect(r.key.pairs.map((p) => p.label)).toEqual(["Digoxin", "Furosemide", "Warfarin", "Heparin"]);
    expect(r.key.pairs[0].why).toContain("From Pharm, p. 9");
    expect(r.key.pairs[2].why).not.toContain("From");
    const perfect = Object.fromEntries(r.key.pairs.map((p) => [p.left, p.right]));
    expect(gradeRound(r.key, { match: perfect }).every((i) => i.correct)).toBe(true);
    expect(medMatchRound({ pairs: raw.pairs.slice(0, 3) }, sources, seeded(1))).toBeNull();
  });

  it("builds triage only from four clients ranked 1 to 4", () => {
    const client = (rank: number, unstable = false) => ({ summary: `Client ${rank}`, rank, unstable, why: "ABCs." });
    const good: TriageRaw = { setting: "Med-surg floor at 0800.", clients: [client(3), client(1, true), client(4), client(2)] };
    const r = triageRound(good, seeded(2));
    if (!r || r.key.kind !== "order") throw new Error("expected order");
    expect(r.key.correct.map((id) => r.key.kind === "order" && r.key.labels[id])).toEqual(["Client 1", "Client 2", "Client 3", "Client 4"]);
    expect(Object.values(r.key.whys).some((w) => w.includes("get the RN now"))).toBe(true);
    expect(triageRound({ ...good, clients: [client(1), client(1), client(2), client(3)] }, seeded(2))).toBeNull();
    expect(triageRound({ ...good, clients: good.clients.slice(0, 3) }, seeded(2))).toBeNull();
  });
});

describe("round endings", () => {
  it("asks unseen questions first, then missed ones, then the longest ago", () => {
    const attempts = [
      { practice_item_id: "right-old", is_correct: true, answered_at: "2026-01-01T00:00:00Z" },
      { practice_item_id: "right-new", is_correct: true, answered_at: "2026-06-01T00:00:00Z" },
      { practice_item_id: "missed", is_correct: true, answered_at: "2026-01-01T00:00:00Z" },
      { practice_item_id: "missed", is_correct: false, answered_at: "2026-02-01T00:00:00Z" },
    ];
    expect(rankForEnding(["right-new", "missed", "unseen", "right-old"], attempts)).toEqual(["unseen", "missed", "right-old", "right-new"]);
  });
});
