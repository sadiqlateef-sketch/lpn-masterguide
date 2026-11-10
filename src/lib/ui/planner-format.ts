// Plain-language labels for the planner screens. Pure, so they can be tested.

import type { PaceView } from "@/lib/api-types";

export const WEEKDAYS = [
  { iso: 1, short: "Mon", long: "Monday" },
  { iso: 2, short: "Tue", long: "Tuesday" },
  { iso: 3, short: "Wed", long: "Wednesday" },
  { iso: 4, short: "Thu", long: "Thursday" },
  { iso: 5, short: "Fri", long: "Friday" },
  { iso: 6, short: "Sat", long: "Saturday" },
  { iso: 7, short: "Sun", long: "Sunday" },
] as const;

// "19:30" -> "7:30 PM" (or "19:30" where the phone uses a 24-hour clock).
export function formatTime(hhmm: string, locale?: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 5, h, m)));
}

// "2026-11-17" -> "Tue, Nov 17".
export function formatDay(day: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

// 45 -> "45 min", 90 -> "1 h 30 min", 120 -> "2 h".
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// When the next review falls, said the way a person would.
export function dueLabel(dueOn: string, today: string, locale?: string): string {
  const days = Math.round((Date.parse(`${dueOn}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days, ${formatDay(dueOn, locale)}`;
  return formatDay(dueOn, locale);
}

export type PaceTone = "good" | "warn" | "bad" | "neutral";

// One line on how the path is pacing toward the next exam.
export function paceMessage(p: PaceView, locale?: string): { tone: PaceTone; text: string } {
  const exam = p.exam ? `${p.exam.kind === "nclex" ? "NCLEX-PN" : "HESI"} on ${formatDay(p.exam.date, locale)}` : null;
  const perDay = plural(p.stonesPerStudyDay, "stone");
  switch (p.status) {
    case "done":
      return { tone: "good", text: exam ? `Every stone is mastered. Reviews carry you to the ${exam}.` : "Every stone is mastered. Keep up the reviews." };
    case "no_exam":
      return { tone: "neutral", text: `Add your exam date to pace the path. For now: ${perDay} a study day.` };
    case "on_track":
      return { tone: "good", text: `On track for the ${exam}: ${perDay} a study day.` };
    case "tight":
      return { tone: "warn", text: `Tight for the ${exam}: ${perDay} a study day, about all your study times fit.` };
    case "behind":
      return p.studyDaysLeft === 0
        ? { tone: "bad", text: `The ${exam} is close. Focus on reviews and your weakest stones.` }
        : { tone: "bad", text: `Behind for the ${exam}: ${perDay} a study day needed, about ${p.capacityPerStudyDay} fit. Add study time.` };
  }
}
