"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpenText, CircleHelp, Gamepad2, Loader2, Lock, NotebookPen, RefreshCw, X } from "lucide-react";
import type { CoursePlanView, PlanCoverage, PlanWeekView, StoneStatus } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { EMPTY_QUICK_PLAY, QuickPlay, type QuickPlayState } from "./QuickPlay";

// The course plan: weeks of stones drafted from the student's own books, notes and questions.
// It redrafts itself when a source was added since, and every week ends with NCLEX-style questions.

type Props = {
  courseId: string;
  courseName: string;
  onOpenStone: (stone: { id: string; title: string }) => void;
};

const COVERAGE: Record<PlanCoverage, { label: string; className: string; note?: string }> = {
  full: { label: "Full sources", className: "bg-emerald-400/15 text-emerald-200" },
  partial: { label: "Some sources", className: "bg-amber-300/15 text-amber-200", note: "Some stones here have only the table of contents behind them." },
  outline_only: {
    label: "Outline only",
    className: "bg-white/10 text-white/70",
    note: "Only the table of contents covers this week. Add the book's PDF or your notes for a deeper plan.",
  },
};

const DOT: Record<StoneStatus, string> = {
  ready: "bg-sky-400",
  mastered: "bg-emerald-400",
  needs_review: "bg-rose-400",
  locked: "bg-white/25",
};

type Load = { state: "loading" } | { state: "drafting" } | { state: "ready"; plan: CoursePlanView } | { state: "error"; message: string };

export function PlanView({ courseId, courseName, onOpenStone }: Props) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [checkpoint, setCheckpoint] = useState<PlanWeekView | null>(null);

  const draft = useCallback(
    async (force: boolean) => {
      setLoad({ state: "drafting" });
      try {
        setLoad({ state: "ready", plan: (await api.generateCoursePlan(courseId, force)).plan });
      } catch (e) {
        setLoad({ state: "error", message: e instanceof Error ? e.message : "The plan didn't load. Try again." });
      }
    },
    [courseId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    api
      .coursePlan(courseId)
      .then(({ plan }) => {
        if (cancelled) return;
        // No plan yet, or a source changed since: draft a fresh one.
        if (!plan || plan.stale) void draft(false);
        else setLoad({ state: "ready", plan });
      })
      .catch((e: unknown) => !cancelled && setLoad({ state: "error", message: e instanceof Error ? e.message : "The plan didn't load. Try again." }));
    return () => {
      cancelled = true;
    };
  }, [courseId, draft]);

  if (load.state === "loading" || load.state === "drafting") {
    return (
      <GlassCard glow="violet" className="flex flex-col items-center gap-3 p-7 text-center" role="status" aria-live="polite">
        <Loader2 aria-hidden className="h-10 w-10 animate-spin text-violet-200" strokeWidth={2.5} />
        <p className="text-lg font-semibold">{load.state === "drafting" ? `Drafting your ${courseName} plan...` : "Loading your plan..."}</p>
        {load.state === "drafting" && <p className="text-sm text-white/60">It reads every book page and note you added. About a minute.</p>}
      </GlassCard>
    );
  }

  if (load.state === "error") {
    return (
      <GlassCard glow="ruby" role="alert">
        <p className="text-lg font-semibold">{load.message}</p>
        <GlossyButton variant="ruby" className="mt-4" onClick={() => void draft(false)}>
          Try again
        </GlossyButton>
      </GlassCard>
    );
  }

  const { plan } = load;
  const counts = plan.sourceCounts;
  return (
    <div className="flex flex-col gap-4">
      <GlassCard glow="violet" className="p-6">
        <p className="text-xs font-bold uppercase tracking-wide text-violet-200">{courseName} plan</p>
        <p className="mt-2 text-base leading-relaxed text-white/90">{plan.summary || `${plan.weeks.length} weeks, in path order.`}</p>
        <p className="mt-3 text-sm text-white/60">
          Built from {counts.textbookPassages} textbook passage{counts.textbookPassages === 1 ? "" : "s"}, {counts.notes} note passage
          {counts.notes === 1 ? "" : "s"} and {counts.questions} saved question{counts.questions === 1 ? "" : "s"}. Add more and the plan gets deeper.
        </p>
        <GlossyButton className="mt-4" onClick={() => void draft(true)} icon={<RefreshCw className="h-4 w-4" strokeWidth={2.5} />}>
          Redraft
        </GlossyButton>
      </GlassCard>

      <ol className="flex flex-col gap-4">
        {plan.weeks.map((week) => (
          <li key={week.week}>
            <WeekCard week={week} onOpenStone={onOpenStone} onCheckpoint={() => setCheckpoint(week)} />
          </li>
        ))}
      </ol>

      <CheckpointSheet week={checkpoint} onClose={() => setCheckpoint(null)} />
    </div>
  );
}

function sourceLine(week: PlanWeekView): string[] {
  return [
    ...week.sources.textbookPages.map((t) => `${t.book}, ${t.pages}`),
    ...week.sources.notebooks.map((n) => `${n.name} (${n.notes})`),
    ...(week.sources.questions ? [`${week.sources.questions} saved question${week.sources.questions === 1 ? "" : "s"}`] : []),
  ];
}

function WeekCard({ week, onOpenStone, onCheckpoint }: { week: PlanWeekView; onOpenStone: Props["onOpenStone"]; onCheckpoint: () => void }) {
  const coverage = COVERAGE[week.coverage];
  const sources = sourceLine(week);
  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-white/55">Week {week.week}</p>
          <h3 className="mt-1 text-xl font-bold leading-tight">{week.title}</h3>
        </div>
        <span className={cn("shrink-0 rounded-full px-3 py-1 text-xs font-bold", coverage.className)}>{coverage.label}</span>
      </div>

      <ul className="mt-3 space-y-1.5">
        {week.goals.map((goal) => (
          <li key={goal} className="flex gap-2 text-base leading-snug text-white/85">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-300" />
            {goal}
          </li>
        ))}
      </ul>

      <ul className="mt-4 flex flex-col gap-1" aria-label={`Stones in week ${week.week}`}>
        {week.stones.map((stone) => {
          const locked = stone.status === "locked";
          return (
            <li key={stone.id}>
              <button
                type="button"
                disabled={locked}
                onClick={() => onOpenStone(stone)}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2 text-left text-sm font-semibold text-white/85 hover:bg-white/[0.06] disabled:text-white/50 disabled:hover:bg-transparent"
              >
                <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[stone.status])} />
                <span className="min-w-0 flex-1 truncate">{stone.title}</span>
                {locked && <Lock aria-label="Locked" className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />}
              </button>
            </li>
          );
        })}
      </ul>

      {sources.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-white/55">
          {sources.map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              {i < week.sources.textbookPages.length ? (
                <BookOpenText aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />
              ) : i < week.sources.textbookPages.length + week.sources.notebooks.length ? (
                <NotebookPen aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />
              ) : (
                <CircleHelp aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />
              )}
              {s}
            </span>
          ))}
        </p>
      )}
      {coverage.note && <p className="mt-2 text-xs text-white/55">{coverage.note}</p>}

      <div className="mt-4">
        {week.checkpoint.length > 0 ? (
          <GlossyButton variant="emerald" onClick={onCheckpoint} icon={<Gamepad2 className="h-4 w-4" strokeWidth={2.5} />}>
            Week {week.week} checkpoint: {week.checkpoint.length} question{week.checkpoint.length === 1 ? "" : "s"}
          </GlossyButton>
        ) : (
          <p className="text-sm text-white/55">The week&apos;s NCLEX checkpoint fills in as you open its lessons.</p>
        )}
      </div>
    </GlassCard>
  );
}

function CheckpointSheet({ week, onClose }: { week: PlanWeekView | null; onClose: () => void }) {
  const [state, setState] = useState<QuickPlayState>(EMPTY_QUICK_PLAY);
  useEffect(() => setState(EMPTY_QUICK_PLAY), [week]);
  return (
    <AnimatePresence>
      {week && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Week ${week.week} checkpoint`}
          className="fixed inset-0 z-[60] flex flex-col bg-canvas/95 px-4 pb-[max(1.5rem,var(--safe-bottom))] pt-[max(1rem,var(--safe-top))] backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="mx-auto flex w-full max-w-md items-center justify-between">
            <p className="text-sm font-bold uppercase tracking-wide text-emerald-200">Week {week.week} checkpoint</p>
            <GlossyButton size="icon" onClick={onClose} aria-label="Close checkpoint" icon={<X className="h-6 w-6" strokeWidth={2.5} />} />
          </div>
          <div className="mx-auto mt-4 w-full max-w-md flex-1 overflow-y-auto overscroll-contain">
            <GlassCard glow="emerald" className="p-6">
              <QuickPlay
                stoneId={week.stones[0]?.id ?? ""}
                stoneTitle={week.title}
                items={week.checkpoint}
                state={state}
                setState={setState}
                onDone={onClose}
                onRoundDone={onClose}
              />
            </GlassCard>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
