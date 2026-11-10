import type { ChoiceView, GameAnswer, GameId, GameItemResult, GameRoundView } from "@/lib/api-types";
import type { ClientNeedId } from "@/lib/blueprint-ids";
import type { MedMatchRaw, TriageRaw } from "../ai-schemas";
import { checkedQuotes, type NumberedSource } from "../anki/sources";
import {
  ISOLATION_CARDS,
  LAB_BAND_LABELS,
  LABS,
  PPE_DOFFING,
  PPE_DONNING,
  PRECAUTION_LABELS,
  PRECAUTION_WHY,
  ROLE_LABELS,
  SCOPE_CARDS,
  type LabBand,
  type Precaution,
  type Role,
} from "./bank";
import { checkMedMath, fmt, medMathRound, type MedMathProblem, type Rng } from "./medmath";

// Builds one round of each game with its answer key, and grades an answer against the key.
// The key stays on the server; the student only ever gets `view`.

export type RoundKey =
  | { kind: "match"; pairs: { left: string; right: string; label: string; expected: string; why: string }[] }
  | { kind: "bins"; cards: { id: string; bin: string; label: string; why: string }[]; bins: ChoiceView[] }
  | { kind: "order"; correct: string[]; labels: Record<string, string>; whys: Record<string, string> }
  | { kind: "calc"; problems: MedMathProblem[] };

export type StoredRound = { title: string; timeLimitSeconds: number | null; view: GameRoundView; key: RoundKey; facts: string };

export const GAME_INFO: Record<GameId, { title: string; blurb: string; clientNeed: ClientNeedId; fromStones: boolean }> = {
  med_match: { title: "Med match", blurb: "Match each medication to its class, effect or key nursing action.", clientNeed: "pharm", fromStones: true },
  lab_levels: { title: "Lab values: high or low?", blurb: "Sort lab results into low, normal and high, then see what the LPN does.", clientNeed: "risk_reduction", fromStones: false },
  triage: { title: "Priority triage", blurb: "Put four clients in the order you'd see them, then see who needs the RN.", clientNeed: "coordinated_care", fromStones: true },
  ppe_order: { title: "PPE order", blurb: "Put on and take off PPE in the right order.", clientNeed: "safety_infection", fromStones: false },
  med_math: { title: "Med-math speed round", blurb: "Five dosage, drip-rate and conversion problems against the clock.", clientNeed: "pharm", fromStones: false },
  scope: { title: "Scope or not", blurb: "Sort tasks to the LPN, the RN or the UAP.", clientNeed: "coordinated_care", fromStones: false },
  isolation: { title: "Isolation match", blurb: "Sort diseases into contact, droplet and airborne precautions.", clientNeed: "safety_infection", fromStones: false },
};

export function shuffle<T>(list: readonly T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Picks `count` cards with at least one in every bin.
function spread<T>(cards: readonly T[], binOf: (c: T) => string, bins: readonly string[], count: number, rng: Rng): T[] {
  const chosen: T[] = [];
  for (const bin of bins) {
    const first = shuffle(cards.filter((c) => binOf(c) === bin), rng)[0];
    if (first) chosen.push(first);
  }
  for (const c of shuffle(cards, rng)) {
    if (chosen.length >= count) break;
    if (!chosen.includes(c)) chosen.push(c);
  }
  return shuffle(chosen, rng);
}

function binsRound(
  title: string,
  prompt: string,
  bins: ChoiceView[],
  cards: { id: string; text: string; bin: string; why: string }[],
  facts: string,
): StoredRound {
  return {
    title,
    timeLimitSeconds: null,
    view: { kind: "bins", prompt, bins, cards: cards.map((c) => ({ id: c.id, text: c.text })) },
    key: { kind: "bins", bins, cards: cards.map((c) => ({ id: c.id, bin: c.bin, label: c.text, why: c.why })) },
    facts,
  };
}

export function isolationRound(rng: Rng): StoredRound {
  const order: Precaution[] = ["contact", "droplet", "airborne"];
  const cards = spread(ISOLATION_CARDS, (c) => c.precaution, order, 6, rng);
  const bins = order.map((p) => ({ id: p, text: PRECAUTION_LABELS[p] }));
  return binsRound(
    GAME_INFO.isolation.title,
    "Which precautions does each client need?",
    bins,
    cards.map((c) => ({ id: c.id, text: c.text, bin: c.precaution, why: [PRECAUTION_WHY[c.precaution], c.extra].filter(Boolean).join(" ") })),
    cards.map((c) => `${c.text}: ${PRECAUTION_LABELS[c.precaution]} precautions. ${c.extra ?? ""}`).join("\n") + "\n" + order.map((p) => PRECAUTION_WHY[p]).join("\n"),
  );
}

export function scopeRound(rng: Rng): StoredRound {
  const roles: Role[] = ["lpn", "rn", "uap"];
  const cards = spread(SCOPE_CARDS, (c) => c.role, roles, 6, rng);
  return binsRound(
    GAME_INFO.scope.title,
    "Who should do each task? Clients are stable unless the task says otherwise.",
    roles.map((r) => ({ id: r, text: ROLE_LABELS[r] })),
    cards.map((c) => ({ id: c.id, text: c.text, bin: c.role, why: c.why })),
    cards.map((c) => `${c.text}: ${ROLE_LABELS[c.role]}. ${c.why}`).join("\n"),
  );
}

export function labRound(rng: Rng): StoredRound {
  const bands: LabBand[] = ["low", "normal", "high"];
  const labs = shuffle(LABS, rng).slice(0, 6);
  // Every band shows up at least once.
  const assigned = labs.map((lab, i) => ({ lab, band: i < 3 ? bands[i] : bands[Math.floor(rng() * 3) % 3] }));
  const cards = shuffle(assigned, rng).map(({ lab, band }) => {
    const value = lab.samples[band][Math.floor(rng() * lab.samples[band].length) % lab.samples[band].length];
    const text = `${lab.name}: ${fmt(value)}${lab.unit ? ` ${lab.unit}` : ""}`;
    const action = band === "low" ? lab.low : band === "high" ? lab.high : "No action beyond routine care.";
    return { id: lab.id, text, bin: band, why: `Normal is ${lab.range}${lab.unit ? ` ${lab.unit}` : ""}. ${action}` };
  });
  return binsRound(
    GAME_INFO.lab_levels.title,
    "Is each result low, normal or high? Ranges vary a little between textbooks; your course's numbers win.",
    bands.map((b) => ({ id: b, text: LAB_BAND_LABELS[b] })),
    cards,
    cards.map((c) => `${c.text} is ${LAB_BAND_LABELS[c.bin as LabBand].toLowerCase()}. ${c.why}`).join("\n"),
  );
}

export function ppeRound(rng: Rng): StoredRound {
  const donning = rng() < 0.5;
  const steps = donning ? PPE_DONNING : PPE_DOFFING;
  const what = donning ? "putting on" : "taking off";
  return {
    title: GAME_INFO.ppe_order.title,
    timeLimitSeconds: null,
    view: { kind: "order", prompt: `You're ${what} full PPE for a client on contact and droplet precautions. Put the steps in order, first at the top.`, items: shuffle(steps, rng).map((s) => ({ id: s.id, text: s.text })) },
    key: {
      kind: "order",
      correct: steps.map((s) => s.id),
      labels: Object.fromEntries(steps.map((s) => [s.id, s.text])),
      whys: Object.fromEntries(steps.map((s) => [s.id, s.why])),
    },
    facts: `CDC order for putting on PPE: ${PPE_DONNING.map((s) => s.text).join(", ")}.\nCDC order for taking off PPE: ${PPE_DOFFING.map((s) => s.text).join(", ")}.\n${steps.map((s) => `${s.text}: ${s.why}`).join("\n")}`,
  };
}

export function medMathGameRound(rng: Rng): StoredRound {
  const problems = medMathRound(rng);
  return {
    title: GAME_INFO.med_math.title,
    timeLimitSeconds: 300,
    view: { kind: "calc", prompt: "Five problems. Type each answer; the unit is filled in for you.", problems: problems.map((p) => ({ id: p.id, text: p.text, unit: p.unit })) },
    key: { kind: "calc", problems },
    facts: problems.map((p) => `${p.text} Answer: ${fmt(p.answer)} ${p.unit}. ${p.steps.join("; ")}`).join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Rounds Claude drafts from the student's stones
// ---------------------------------------------------------------------------

const MIN_PAIRS = 4;
const MAX_PAIRS = 6;

const short = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

export function medMatchRound(raw: MedMatchRaw, sources: readonly NumberedSource[], rng: Rng): StoredRound | null {
  const seenLeft = new Set<string>();
  const seenRight = new Set<string>();
  const pairs: { medication: string; match: string; why: string }[] = [];
  for (const p of raw.pairs) {
    const medication = short(p.medication, 80);
    const match = short(p.match, 120);
    const left = medication.toLowerCase();
    const right = match.toLowerCase();
    if (!medication || !match || seenLeft.has(left) || seenRight.has(right)) continue;
    seenLeft.add(left);
    seenRight.add(right);
    const sourced = p.source >= 0 && p.quote.trim() ? checkedQuotes([{ source: p.source, quote: p.quote }], sources).refs[0] : undefined;
    const why = short(p.why, 300) + (sourced ? ` (From ${sourced.label}.)` : "");
    pairs.push({ medication, match, why });
    if (pairs.length === MAX_PAIRS) break;
  }
  if (pairs.length < MIN_PAIRS) return null;
  const keyed = pairs.map((p, i) => ({ left: `L${i + 1}`, right: `R${i + 1}`, ...p }));
  return {
    title: GAME_INFO.med_match.title,
    timeLimitSeconds: null,
    view: {
      kind: "match",
      prompt: "Match each medication to the right card.",
      left: shuffle(keyed.map((k) => ({ id: k.left, text: k.medication })), rng),
      right: shuffle(keyed.map((k) => ({ id: k.right, text: k.match })), rng),
    },
    key: { kind: "match", pairs: keyed.map((k) => ({ left: k.left, right: k.right, label: k.medication, expected: k.match, why: k.why })) },
    facts: keyed.map((k) => `${k.medication}: ${k.match}. ${k.why}`).join("\n"),
  };
}

export function triageRound(raw: TriageRaw, rng: Rng): StoredRound | null {
  if (raw.clients.length !== 4) return null;
  const ranks = raw.clients.map((c) => Math.round(c.rank));
  if ([1, 2, 3, 4].some((r) => !ranks.includes(r))) return null;
  const clients = raw.clients
    .map((c, i) => ({ id: `C${i + 1}`, text: short(c.summary, 300), rank: Math.round(c.rank), why: short(c.why, 300), unstable: c.unstable }))
    .sort((a, b) => a.rank - b.rank);
  if (clients.some((c) => !c.text)) return null;
  const setting = short(raw.setting, 300);
  return {
    title: GAME_INFO.triage.title,
    timeLimitSeconds: null,
    view: { kind: "order", prompt: `${setting} Who do you see first? Put them in order, first at the top.`, items: shuffle(clients.map((c) => ({ id: c.id, text: c.text })), rng) },
    key: {
      kind: "order",
      correct: clients.map((c) => c.id),
      labels: Object.fromEntries(clients.map((c) => [c.id, c.text])),
      whys: Object.fromEntries(clients.map((c) => [c.id, c.why + (c.unstable ? " This client is unstable: get the RN now." : "")])),
    },
    facts: `${setting}\n${clients.map((c) => `${c.rank}. ${c.text} ${c.why}${c.unstable ? " Unstable: hand off to the RN." : ""}`).join("\n")}`,
  };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export function gradeRound(key: RoundKey, answer: GameAnswer): GameItemResult[] {
  switch (key.kind) {
    case "match": {
      const byRight = new Map(key.pairs.map((p) => [p.right, p.expected]));
      return key.pairs.map((p) => {
        const given = answer.match?.[p.left];
        return { id: p.left, label: p.label, correct: given === p.right, expected: p.expected, given: given ? (byRight.get(given) ?? null) : null, why: p.why };
      });
    }
    case "bins": {
      const binName = new Map(key.bins.map((b) => [b.id, b.text]));
      return key.cards.map((c) => {
        const given = answer.bins?.[c.id];
        return { id: c.id, label: c.label, correct: given === c.bin, expected: binName.get(c.bin) ?? c.bin, given: given ? (binName.get(given) ?? null) : null, why: c.why };
      });
    }
    case "order": {
      const given = answer.order ?? [];
      return key.correct.map((id, i) => {
        const at = given.indexOf(id);
        return {
          id,
          label: key.labels[id] ?? id,
          correct: at === i,
          expected: `Step ${i + 1}`,
          given: at >= 0 ? `Step ${at + 1}` : null,
          why: key.whys[id] ?? "",
        };
      });
    }
    case "calc":
      return key.problems.map((p) => {
        const typed = answer.calc?.[p.id];
        const { correct, note } = checkMedMath(p, typed);
        return {
          id: p.id,
          label: p.text,
          correct,
          expected: `${fmt(p.answer)} ${p.unit}`,
          given: typed?.trim() ? `${typed.trim().slice(0, 30)}` : null,
          why: note ?? "",
          steps: p.steps,
        };
      });
  }
}
