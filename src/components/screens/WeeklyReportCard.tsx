"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck2 } from "lucide-react";
import type { WeeklyReportView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { formatDay, formatMinutes, plural } from "@/lib/ui/planner-format";
import { GLASS_SURFACE, GlassCard } from "@/components/glass/GlassCard";

// The week in numbers: time against plan, days studied, questions and accuracy, what was mastered or slipped,
// and what to focus on next. Last week is kept as it was; this week fills in as it goes.

type Props = {
  refreshKey: number;
  onOpenStone: (stone: { id: string; title: string }) => void;
};

type Which = "thisWeek" | "lastWeek";

export function WeeklyReportCard({ refreshKey, onOpenStone }: Props) {
  const [reports, setReports] = useState<{ lastWeek: WeeklyReportView; thisWeek: WeeklyReportView } | null>(null);
  const [failed, setFailed] = useState(false);
  const [which, setWhich] = useState<Which>("thisWeek");

  const load = useCallback(async () => {
    try {
      setReports(await api.weeklyReports());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => void load(), [load, refreshKey]);

  // The rest of the Readiness screen still works without it, so a failed load just leaves it out.
  if (failed && !reports) return null;
  if (!reports) return <div className="shimmer h-48 rounded-3xl" aria-busy="true" aria-label="Loading your weekly report" />;

  const r = reports[which];
  const range = `${formatDay(r.weekStart)} to ${formatDay(r.weekEnd)}`;
  const accuracy = r.accuracy === null ? "None yet" : `${Math.round(r.accuracy * 100)}%`;
  const change =
    r.accuracyChange === null || Math.round(r.accuracyChange * 100) === 0
      ? null
      : { up: r.accuracyChange > 0, text: `${r.accuracyChange > 0 ? "up" : "down"} ${Math.abs(Math.round(r.accuracyChange * 100))} points` };

  return (
    <section aria-labelledby="week-heading">
      <GlassCard className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="week-heading" className="flex items-center gap-2 text-lg font-bold">
            <CalendarCheck2 aria-hidden className="h-5 w-5 text-sky-300" strokeWidth={2.5} />
            Weekly report
          </h2>
          <div role="group" aria-label="Which week" className={cn("flex rounded-full p-1 text-xs font-bold", GLASS_SURFACE)}>
            {(["thisWeek", "lastWeek"] as const).map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={which === w}
                onClick={() => setWhich(w)}
                className={cn("min-h-9 rounded-full px-3", which === w ? "bg-white/15 text-white" : "text-white/60")}
              >
                {w === "thisWeek" ? "This week" : "Last week"}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-sm text-white/60">
          {range}
          {!r.complete && ", so far"}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-2">
          <Stat label="Studied" value={formatMinutes(r.minutesStudied)} note={r.minutesPlanned > 0 ? `of ${formatMinutes(r.minutesPlanned)} planned` : undefined} />
          <Stat label="Days studied" value={`${r.daysStudied} of 7`} />
          <Stat label="Questions" value={String(r.questions)} note={r.reviews > 0 ? `plus ${plural(r.reviews, "review")}` : undefined} />
          <Stat label="Right" value={accuracy} note={change?.text} noteTone={change ? (change.up ? "good" : "bad") : undefined} />
        </dl>

        {r.mastered.length > 0 && <StoneList title={`Mastered: ${r.mastered.length}`} stones={r.mastered} tone="good" onOpenStone={onOpenStone} />}
        {r.slipped.length > 0 && <StoneList title={`Slipped, learn again: ${r.slipped.length}`} stones={r.slipped} tone="bad" onOpenStone={onOpenStone} />}

        {r.nextFocus.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-white/55">Focus next</p>
            <ul className="mt-1 space-y-1">
              {r.nextFocus.map((f) => (
                <li key={f} className="flex gap-2 text-sm leading-snug text-white/85">
                  <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
      </GlassCard>
    </section>
  );
}

function Stat({ label, value, note, noteTone }: { label: string; value: string; note?: string; noteTone?: "good" | "bad" }) {
  return (
    <div className="rounded-2xl bg-white/[0.05] px-3 py-2">
      <dt className="text-xs font-semibold text-white/60">{label}</dt>
      <dd className="text-lg font-black">{value}</dd>
      {note && <dd className={cn("text-xs font-semibold", noteTone === "good" ? "text-emerald-300" : noteTone === "bad" ? "text-rose-300" : "text-white/55")}>{note}</dd>}
    </div>
  );
}

function StoneList({
  title,
  stones,
  tone,
  onOpenStone,
}: {
  title: string;
  stones: { id: string; title: string }[];
  tone: "good" | "bad";
  onOpenStone: Props["onOpenStone"];
}) {
  const shown = stones.slice(0, 6);
  return (
    <div className="mt-4">
      <p className="text-xs font-bold uppercase tracking-wide text-white/55">{title}</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {shown.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onOpenStone(s)}
              className={cn(
                "min-h-9 rounded-full px-3 text-xs font-bold",
                tone === "good" ? "bg-emerald-400/15 text-emerald-200" : "bg-rose-400/15 text-rose-200",
              )}
            >
              {s.title}
            </button>
          </li>
        ))}
        {stones.length > shown.length && <li className="self-center text-xs font-semibold text-white/55">and {stones.length - shown.length} more</li>}
      </ul>
    </div>
  );
}
