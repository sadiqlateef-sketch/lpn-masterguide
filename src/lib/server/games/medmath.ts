// Med-math problems built in code, so every answer is exact: tablets, liquids, weight-based doses,
// IV drip and pump rates, and unit conversions. Each comes with worked steps.

export type Rng = () => number;

export type MedMathProblem = {
  id: string;
  kind: "tablets" | "liquid" | "weight" | "drip" | "pump" | "convert";
  text: string;
  unit: string;
  answer: number;
  // How far a typed answer may be from `answer` and still count (rounding differences).
  tolerance: number;
  steps: string[];
};

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length) % list.length];

// Rounds to `places` decimals and drops floating-point noise.
export function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f + Number.EPSILON * f) / f;
}

export function fmt(n: number): string {
  // Leading zero, no trailing zeros (safe medication writing).
  return Number.isInteger(n) ? n.toLocaleString("en-US") : String(round(n, 2));
}

function tablets(rng: Rng): Omit<MedMathProblem, "id"> {
  const [drug, strength] = pick(rng, [
    ["metoprolol", 25],
    ["furosemide", 20],
    ["lisinopril", 10],
    ["levothyroxine", 50],
    ["metformin", 500],
    ["carvedilol", 12.5],
    ["prednisone", 5],
    ["amlodipine", 5],
  ] as const);
  const count = pick(rng, [0.5, 1.5, 2, 3]);
  const order = round(strength * count, 2);
  return {
    kind: "tablets",
    text: `Ordered: ${drug} ${fmt(order)} ${drug === "levothyroxine" ? "mcg" : "mg"} by mouth. On hand: ${fmt(strength)} ${drug === "levothyroxine" ? "mcg" : "mg"} tablets. How many tablets do you give?`,
    unit: "tablets",
    answer: count,
    tolerance: 0.001,
    steps: [`Desired ÷ have = ${fmt(order)} ÷ ${fmt(strength)}`, `= ${fmt(count)} tablet${count === 1 ? "" : "s"}`],
  };
}

function liquid(rng: Rng): Omit<MedMathProblem, "id"> {
  const [drug, mg, ml] = pick(rng, [
    ["amoxicillin suspension", 250, 5],
    ["acetaminophen liquid", 160, 5],
    ["cephalexin suspension", 125, 5],
    ["ibuprofen suspension", 100, 5],
    ["potassium chloride solution", 20, 15],
  ] as const);
  const factor = pick(rng, [0.5, 1.2, 1.5, 2, 2.5]);
  const order = round(mg * factor, 1);
  const unit = drug.startsWith("potassium") ? "mEq" : "mg";
  const answer = round((order / mg) * ml, 1);
  return {
    kind: "liquid",
    text: `Ordered: ${drug} ${fmt(order)} ${unit}. On hand: ${mg} ${unit} per ${ml} mL. How many mL do you give? (Round to the tenth.)`,
    unit: "mL",
    answer,
    tolerance: 0.051,
    steps: [`(Desired ÷ have) × volume = (${fmt(order)} ÷ ${mg}) × ${ml} mL`, `= ${fmt(answer)} mL`],
  };
}

function weight(rng: Rng): Omit<MedMathProblem, "id"> {
  const lb = pick(rng, [44, 66, 88, 110, 132, 154, 176, 198]);
  const perKg = pick(rng, [0.5, 1, 2, 5, 10]);
  const kg = round(lb / 2.2, 1);
  const answer = round(kg * perKg, 1);
  return {
    kind: "weight",
    text: `Ordered: ${fmt(perKg)} mg/kg of a medication. The client weighs ${lb} lb. How many mg is the dose?`,
    unit: "mg",
    answer,
    tolerance: Math.max(0.051, answer * 0.01),
    steps: [`Pounds to kg: ${lb} ÷ 2.2 = ${fmt(kg)} kg`, `Dose: ${fmt(kg)} kg × ${fmt(perKg)} mg/kg = ${fmt(answer)} mg`],
  };
}

function drip(rng: Rng): Omit<MedMathProblem, "id"> {
  const volume = pick(rng, [500, 1000, 250, 100]);
  const hours = volume === 100 ? pick(rng, [0.5, 1]) : pick(rng, [2, 4, 6, 8, 10, 12]);
  const factor = pick(rng, [10, 15, 20, 60]);
  const minutes = hours * 60;
  const exact = (volume * factor) / minutes;
  const answer = Math.round(exact);
  return {
    kind: "drip",
    text: `Infuse ${volume} mL over ${hours === 0.5 ? "30 minutes" : `${hours} hour${hours === 1 ? "" : "s"}`} by gravity. The drop factor is ${factor} gtt/mL. How many drops per minute? (Round to a whole drop.)`,
    unit: "gtt/min",
    answer,
    tolerance: 0.5,
    steps: [`Minutes: ${hours} h × 60 = ${minutes} min`, `(Volume × drop factor) ÷ minutes = (${volume} × ${factor}) ÷ ${minutes} = ${fmt(round(exact, 2))}`, `Round to ${answer} gtt/min`],
  };
}

function pump(rng: Rng): Omit<MedMathProblem, "id"> {
  const volume = pick(rng, [1000, 500, 250, 1200]);
  const hours = pick(rng, [4, 6, 8, 10, 12, 24]);
  const exact = volume / hours;
  const answer = round(exact, 1);
  return {
    kind: "pump",
    text: `Infuse ${volume} mL over ${hours} hours on a pump. What rate do you set, in mL/hr? (Round to the tenth.)`,
    unit: "mL/hr",
    answer,
    tolerance: 0.51,
    steps: [`Volume ÷ hours = ${volume} ÷ ${hours}`, `= ${fmt(answer)} mL/hr`],
  };
}

function convert(rng: Rng): Omit<MedMathProblem, "id"> {
  const choice = pick(rng, ["g_mg", "mg_g", "mg_mcg", "mcg_mg", "lb_kg", "tsp_ml", "tbsp_ml", "oz_ml"] as const);
  switch (choice) {
    case "g_mg": {
      const g = pick(rng, [0.25, 0.5, 1.5, 2]);
      return { kind: "convert", text: `Convert ${fmt(g)} g to mg.`, unit: "mg", answer: g * 1000, tolerance: 0.001, steps: ["1 g = 1,000 mg", `${fmt(g)} × 1,000 = ${fmt(g * 1000)} mg`] };
    }
    case "mg_g": {
      const mg = pick(rng, [250, 500, 750, 1500]);
      return { kind: "convert", text: `Convert ${fmt(mg)} mg to g.`, unit: "g", answer: mg / 1000, tolerance: 0.001, steps: ["1,000 mg = 1 g", `${fmt(mg)} ÷ 1,000 = ${fmt(mg / 1000)} g`] };
    }
    case "mg_mcg": {
      const mg = pick(rng, [0.125, 0.25, 0.5, 2]);
      return { kind: "convert", text: `Convert ${fmt(mg)} mg to mcg.`, unit: "mcg", answer: round(mg * 1000, 3), tolerance: 0.001, steps: ["1 mg = 1,000 mcg", `${fmt(mg)} × 1,000 = ${fmt(round(mg * 1000, 3))} mcg`] };
    }
    case "mcg_mg": {
      const mcg = pick(rng, [125, 250, 500, 50]);
      return { kind: "convert", text: `Convert ${fmt(mcg)} mcg to mg.`, unit: "mg", answer: mcg / 1000, tolerance: 0.0001, steps: ["1,000 mcg = 1 mg", `${fmt(mcg)} ÷ 1,000 = ${fmt(mcg / 1000)} mg`] };
    }
    case "lb_kg": {
      const lb = pick(rng, [110, 143, 165, 187, 220]);
      const kg = round(lb / 2.2, 1);
      return { kind: "convert", text: `Convert ${lb} lb to kg. (Round to the tenth.)`, unit: "kg", answer: kg, tolerance: 0.051, steps: ["2.2 lb = 1 kg", `${lb} ÷ 2.2 = ${fmt(kg)} kg`] };
    }
    case "tsp_ml": {
      const tsp = pick(rng, [1, 2, 3]);
      return { kind: "convert", text: `How many mL are in ${tsp} teaspoon${tsp === 1 ? "" : "s"}?`, unit: "mL", answer: tsp * 5, tolerance: 0.001, steps: ["1 tsp = 5 mL", `${tsp} × 5 = ${tsp * 5} mL`] };
    }
    case "tbsp_ml": {
      const tbsp = pick(rng, [1, 2]);
      return { kind: "convert", text: `How many mL are in ${tbsp} tablespoon${tbsp === 1 ? "" : "s"}?`, unit: "mL", answer: tbsp * 15, tolerance: 0.001, steps: ["1 tbsp = 15 mL", `${tbsp} × 15 = ${tbsp * 15} mL`] };
    }
    case "oz_ml": {
      const oz = pick(rng, [4, 6, 8]);
      return { kind: "convert", text: `A client drank ${oz} oz of juice. How many mL is that for the intake record?`, unit: "mL", answer: oz * 30, tolerance: 0.001, steps: ["1 oz = 30 mL", `${oz} × 30 = ${oz * 30} mL`] };
    }
  }
}

const MAKERS = [tablets, liquid, weight, drip, pump, convert];

// Five problems, never two of the same kind in a row.
export function medMathRound(rng: Rng = Math.random, count = 5): MedMathProblem[] {
  const out: MedMathProblem[] = [];
  const kinds = [...MAKERS].sort(() => rng() - 0.5);
  for (let i = 0; i < count; i++) {
    const p = kinds[i % kinds.length](rng);
    out.push({ ...p, id: `P${i + 1}` });
  }
  return out;
}

// Reads a typed answer: "1.5", "1 1/2", "3/4", "1,000", "12 mL". Returns null when it isn't a number.
export function parseAnswer(typed: string): number | null {
  const t = typed.trim().toLowerCase().replace(/,/g, "");
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)(?![\d.])/.exec(t);
  if (mixed) return Number(mixed[3]) === 0 ? null : Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\s*\/\s*(\d+)(?![\d.])/.exec(t);
  if (frac) return Number(frac[2]) === 0 ? null : Number(frac[1]) / Number(frac[2]);
  const num = /^(\d+(\.\d+)?|\.\d+)(?![\d.])/.exec(t);
  return num ? Number(num[0]) : null;
}

export function checkMedMath(problem: MedMathProblem, typed: string | undefined): { correct: boolean; note: string | null } {
  if (!typed?.trim()) return { correct: false, note: null };
  const value = parseAnswer(typed);
  if (value === null || !Number.isFinite(value)) return { correct: false, note: "That isn't a number." };
  const correct = Math.abs(value - problem.answer) <= problem.tolerance;
  const trimmed = typed.trim();
  const note = /^\./.test(trimmed)
    ? `Write a leading zero (${"0" + trimmed.split(/\s/)[0]}) so the decimal point can't be missed.`
    : /^\d+\.0+(\s|$)/.test(trimmed)
      ? "Leave off trailing zeros (write 5, not 5.0): a missed decimal point turns 5.0 into 50."
      : null;
  return { correct, note };
}
