import type { AttemptRequest, BowtieAnswer, PracticeView } from "@/lib/api-types";

// Adds an option to a pick list, dropping the oldest pick once the limit is reached.
export function togglePick(current: readonly string[], id: string, limit: number): string[] {
  if (current.includes(id)) return current.filter((x) => x !== id);
  const next = [...current, id];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

// Moves one item up (-1) or down (+1), for ordered-response questions.
export function moveItem<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export type ClozePart = { kind: "text"; text: string } | { kind: "blank"; id: string };

// Splits "The client's {{1}} is low" into text and blank parts.
export function splitCloze(text: string): ClozePart[] {
  const parts: ClozePart[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{\{\s*([\w-]{1,20})\s*\}\}/g)) {
    if (m.index > last) parts.push({ kind: "text", text: text.slice(last, m.index) });
    parts.push({ kind: "blank", id: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}


// Every kind of answer a practice question can hold while the student works on it.
export type AnswerState = {
  picks: Record<string, string[]>;
  bowtie: Record<string, BowtieAnswer>;
  matrix: Record<string, Record<string, string>>;
  cloze: Record<string, Record<string, string>>;
  order: Record<string, string[]>;
};

export const EMPTY_ANSWERS: AnswerState = { picks: {}, bowtie: {}, matrix: {}, cloze: {}, order: {} };

export function orderFor(item: Extract<PracticeView, { type: "ordered" }>, answers: AnswerState): string[] {
  return answers.order[item.id] ?? item.items.map((i) => i.id);
}

export function isAnswerReady(item: PracticeView, answers: AnswerState): boolean {
  switch (item.type) {
    case "bowtie": {
      const b = answers.bowtie[item.id];
      return Boolean(b?.condition && b.actions.length === item.actions.pick && b.parameters.length === item.parameters.pick);
    }
    case "matrix":
      return item.rows.every((r) => answers.matrix[item.id]?.[r.id]);
    case "cloze":
      return item.blanks.every((b) => answers.cloze[item.id]?.[b.id]);
    case "ordered":
      return true;
    default:
      return (answers.picks[item.id]?.length ?? 0) > 0;
  }
}

export function attemptBody(item: PracticeView, answers: AnswerState): AttemptRequest {
  switch (item.type) {
    case "bowtie":
      return { itemId: item.id, bowtie: answers.bowtie[item.id] };
    case "matrix":
      return { itemId: item.id, matrix: answers.matrix[item.id] ?? {} };
    case "cloze":
      return { itemId: item.id, cloze: answers.cloze[item.id] ?? {} };
    case "ordered":
      return { itemId: item.id, order: orderFor(item, answers) };
    default:
      return { itemId: item.id, selected: answers.picks[item.id] ?? [] };
  }
}
