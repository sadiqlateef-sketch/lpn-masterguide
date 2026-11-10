"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, CalendarClock, Flame, RotateCcw } from "lucide-react";
import type { TodayStone, TodayView } from "@/lib/api-types";
import { api, deviceTimeZone } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { formatMinutes, formatTime, paceMessage, plural, type PaceTone } from "@/lib/ui/planner-format";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";

// The top of the Path: today's reviews, stones to learn and a question goal, sized to today's study times.

type Props = {
  refreshKey: number;
  onOpenStone: (stone: { id: string; title: string }) => void;
  onReview: (stone: { id: string; title: string }) => void;
  onOpenPlanner: () => void;
};

const TONE: Record<PaceTone, string> = {
  good: "text-emerald-200",
  warn: "text-amber-200",
  bad: "text-rose-200",
  neutral: "text-white/70",
};

export function TodayCard({ refreshKey, onOpenStone, onReview, onOpenPlanner }: Props) {
  const [today, setToday] = useState<TodayView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setToday(await api.today(deviceTimeZone()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Today's plan didn't load.");
    }
  }, []);
  useEffect(() => void load(), [load, refreshKey]);

  if (error && !today) {
    return (
      <GlassCard className="flex items-center justify-between gap-3 p-4" role="alert">
        <p className="text-sm font-semibold text-white/80">{error}</p>
        <GlossyButton onClick={() => void load()}>Try again</GlossyButton>
      </GlassCard>
    );
  }
  if (!today) return <div className="shimmer h-40 w-full rounded-3xl" aria-busy="true" aria-label="Loading today's plan" />;

  const pace = paceMessage(today.pace);
  const nothingLeft = today.reviews.length === 0 && today.learn.length === 0;
  return (
    <GlassCard glow="blue" className="p-5" aria-labelledby="today-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="today-title" className="text-xl font-bold">
          Today
        </h2>
        <Streak current={today.streak.current} best={today.streak.best} activeToday={today.streak.activeToday} />
      </div>

      {today.hasSetup ? (
        <p className={cn("mt-1 text-sm font-semibold", TONE[pace.tone])}>{pace.text}</p>
      ) : (
        <p className="mt-1 text-sm text-white/70">Add your exam dates and study times, and the path paces itself.</p>
      )}

      {today.blocks.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Today's study times">
          {today.blocks.map((b) => (
            <li key={b.start} className="rounded-full bg-white/[0.08] px-3 py-1 text-xs font-bold text-white/80">
              {formatTime(b.start)} · {formatMinutes(b.minutes)} · {b.courseName}
            </li>
          ))}
        </ul>
      ) : (
        today.hasSetup &&
        today.plannedMinutes === 0 && <p className="mt-3 text-sm text-white/60">No study time planned today. A quick review keeps the streak going.</p>
      )}

      {today.reviews.length > 0 && (
        <Section
          title={today.reviewsDueTotal > today.reviews.length ? `Review: ${today.reviews.length} of ${today.reviewsDueTotal} due` : `Review: ${plural(today.reviews.length, "stone")}`}
        >
          {today.reviews.map((s) => (
            <StoneRow key={s.id} stone={s} note={s.overdueDays > 0 ? `${plural(s.overdueDays, "day")} late` : undefined} kind="review" onPress={() => onReview(s)} />
          ))}
        </Section>
      )}

      {today.learn.length > 0 && (
        <Section title={today.learnGoal > today.learn.length ? `Learn: goal ${today.learnGoal}, ${today.learn.length} open now` : "Learn"}>
          {today.learn.map((s) => (
            <StoneRow key={s.id} stone={s} note={s.status === "needs_review" ? "slipped" : undefined} kind="learn" onPress={() => onOpenStone(s)} />
          ))}
        </Section>
      )}

      {nothingLeft && today.plannedMinutes > 0 && <p className="mt-4 text-sm text-white/70">Nothing open to learn or review right now. Add a book or notes with the + below.</p>}

      <div className="mt-4 grid grid-cols-3 gap-2 text-center" aria-label="Done today">
        <Count label="Questions" value={today.done.questions} goal={today.questionsGoal} />
        <Count label="Stones" value={today.done.stones} goal={today.learnGoal} />
        <Count label="Minutes" value={today.done.minutes} goal={today.plannedMinutes} />
      </div>

      <GlossyButton className="mt-4 w-full" onClick={onOpenPlanner} icon={<CalendarClock className="h-4 w-4" strokeWidth={2.5} />}>
        {today.hasSetup ? "Exam dates and study times" : "Plan my week"}
      </GlossyButton>
    </GlassCard>
  );
}

function Streak({ current, best, activeToday }: { current: number; best: number; activeToday: boolean }) {
  const label = current === 0 ? "No streak yet" : `${plural(current, "day")} in a row`;
  return (
    <span
      className={cn("flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold", current > 0 ? "bg-amber-300/15 text-amber-200" : "bg-white/[0.06] text-white/60")}
      title={best > current ? `Best: ${plural(best, "day")}` : undefined}
    >
      <Flame aria-hidden className={cn("h-4 w-4", activeToday ? "text-amber-300" : "text-white/50")} strokeWidth={2.5} />
      {label}
      {current > 0 && !activeToday && <span className="sr-only">, study today to keep it</span>}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="text-xs font-bold uppercase tracking-wide text-white/55">{title}</p>
      <ul className="mt-1 flex flex-col">{children}</ul>
    </div>
  );
}

function StoneRow({ stone, note, kind, onPress }: { stone: TodayStone; note?: string; kind: "review" | "learn"; onPress: () => void }) {
  const Icon = kind === "review" ? RotateCcw : BookOpen;
  return (
    <li>
      <button
        type="button"
        onClick={onPress}
        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-sky-300"
      >
        <Icon aria-hidden className={cn("h-4 w-4 shrink-0", kind === "review" ? "text-amber-200" : stone.status === "needs_review" ? "text-rose-300" : "text-sky-300")} strokeWidth={2.5} />
        <span className="min-w-0 flex-1 truncate font-semibold">{stone.title}</span>
        {note && <span className="shrink-0 text-xs font-semibold text-white/55">{note}</span>}
        <span className="sr-only">{kind === "review" ? ", start review" : ", open lesson"}</span>
      </button>
    </li>
  );
}

function Count({ label, value, goal }: { label: string; value: number; goal: number }) {
  const met = goal > 0 && value >= goal;
  return (
    <div className="rounded-2xl bg-white/[0.05] px-2 py-2">
      <p className={cn("text-lg font-black", met ? "text-emerald-300" : "text-white")}>
        {value}
        {goal > 0 && <span className="text-sm font-bold text-white/50"> / {goal}</span>}
      </p>
      <p className="text-xs font-semibold text-white/60">{label}</p>
    </div>
  );
}
