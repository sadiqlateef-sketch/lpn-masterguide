"use client";

import { useCallback, useEffect, useState } from "react";
import { Beaker, Calculator, ClipboardCheck, ClipboardList, Stethoscope, HeartPulse, Layers, NotebookPen, Pill, ShieldCheck, Shirt, Siren, Sparkles, Users } from "lucide-react";
import type { ExamSummary, GameId, GameSummary, PathView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import type { ExamOpen } from "./ExamSheet";
import { errorText } from "./FullSheet";

// Practice, under the readiness rings: games, practice exams, the mistake notebook, drug cards and NGN practice by stone.

const GAME_ICONS: Record<GameId, typeof Pill> = {
  med_match: Pill,
  lab_levels: Beaker,
  triage: Siren,
  ppe_order: Shirt,
  med_math: Calculator,
  scope: Users,
  isolation: ShieldCheck,
};

type Props = {
  path: PathView | null;
  refreshKey: number;
  onOpenGame: (game: GameSummary) => void;
  onOpenExam: (how: ExamOpen) => void;
  onOpenMistakes: () => void;
  onOpenDrugs: () => void;
  onOpenNgn: (stone: { id: string; title: string }) => void;
  onOpenSkills: () => void;
  onOpenClinical: () => void;
};

export function PracticeHub({ path, refreshKey, onOpenGame, onOpenExam, onOpenMistakes, onOpenDrugs, onOpenNgn, onOpenSkills, onOpenClinical }: Props) {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [g, e] = await Promise.all([api.games(), api.exams()]);
      setGames(g.games);
      setExams(e.exams);
    } catch (e) {
      setError(errorText(e, "Practice didn't load."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const studied = (path?.courses ?? [])
    .flatMap((c) => c.books.flatMap((b) => b.units.flatMap((u) => u.modules.flatMap((m) => m.stones))))
    .filter((s) => s.status === "mastered" || s.status === "needs_review");
  const openExam = exams?.find((x) => !x.finishedAt) ?? null;
  const lastExam = exams?.find((x) => x.finishedAt) ?? null;

  return (
    <section aria-labelledby="practice-heading" className="flex flex-col gap-6">
      <h2 id="practice-heading" className="mt-2 text-2xl font-bold text-white">
        Practice
      </h2>
      {error && (
        <GlassCard glow="ruby" role="alert">
          <p className="font-semibold">{error}</p>
          <GlossyButton variant="ruby" className="mt-3" onClick={() => void load()}>
            Try again
          </GlossyButton>
        </GlassCard>
      )}

      <section aria-labelledby="games-heading" className="flex flex-col gap-3">
        <h3 id="games-heading" className="text-lg font-bold">
          Games
        </h3>
        {games === null && !error ? (
          <p className="text-white/60" role="status">
            Loading games...
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {(games ?? []).map((g) => {
              const Icon = GAME_ICONS[g.id];
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => onOpenGame(g)}
                    disabled={!g.available}
                    className={cn(
                      "flex h-full min-h-32 w-full flex-col gap-2 rounded-3xl bg-white/[0.07] p-4 text-left ring-1 ring-white/10 focus-visible:outline-2 focus-visible:outline-violet-300",
                      !g.available && "opacity-55",
                    )}
                  >
                    <Icon aria-hidden className="h-7 w-7 text-violet-200" strokeWidth={2.2} />
                    <span className="font-bold leading-tight">{g.title}</span>
                    <span className="text-xs leading-snug text-white/65">{g.available ? g.blurb : g.unavailableReason}</span>
                    {g.bestPct !== null && <span className="mt-auto text-xs font-semibold text-violet-200">Best {g.bestPct}%</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="exam-heading">
        <GlassCard glow="blue">
          <h3 id="exam-heading" className="flex items-center gap-2 text-lg font-bold">
            <ClipboardCheck aria-hidden className="h-5 w-5 text-sky-200" strokeWidth={2.5} />
            Practice exam
          </h3>
          <p className="mt-1 text-sm text-white/70">Timed and adaptive, drawn from your own questions. No feedback until it ends, like the real test.</p>
          {lastExam && (
            <p className="mt-2 text-sm text-white/80">
              Last one: {lastExam.correct} of {lastExam.answered} right.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            {openExam ? (
              <GlossyButton variant="blue" onClick={() => onOpenExam({ resume: openExam.id })}>
                Go back to your exam
              </GlossyButton>
            ) : (
              <>
                <GlossyButton variant="blue" onClick={() => onOpenExam({ start: "short" })}>
                  Short: up to 40, 1 hour
                </GlossyButton>
                <GlossyButton onClick={() => onOpenExam({ start: "long" })}>Long: up to 85, 2 hours</GlossyButton>
              </>
            )}
          </div>
        </GlassCard>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={onOpenMistakes} className="flex min-h-28 flex-col gap-2 rounded-3xl bg-white/[0.07] p-4 text-left ring-1 ring-white/10 focus-visible:outline-2 focus-visible:outline-rose-300">
          <NotebookPen aria-hidden className="h-7 w-7 text-rose-200" strokeWidth={2.2} />
          <span className="font-bold">Mistake notebook</span>
          <span className="text-xs text-white/65">Every miss, with your notes, to redo.</span>
        </button>
        <button type="button" onClick={onOpenDrugs} className="flex min-h-28 flex-col gap-2 rounded-3xl bg-white/[0.07] p-4 text-left ring-1 ring-white/10 focus-visible:outline-2 focus-visible:outline-emerald-300">
          <HeartPulse aria-hidden className="h-7 w-7 text-emerald-200" strokeWidth={2.2} />
          <span className="font-bold">Drug cards</span>
          <span className="text-xs text-white/65">A card for any medication, from your sources.</span>
        </button>
      </div>

      <section aria-labelledby="clinical-heading" className="flex flex-col gap-3">
        <h3 id="clinical-heading" className="text-lg font-bold">
          Clinical
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={onOpenSkills} className="flex min-h-28 flex-col gap-2 rounded-3xl bg-white/[0.07] p-4 text-left ring-1 ring-white/10 focus-visible:outline-2 focus-visible:outline-cyan-300">
            <ClipboardList aria-hidden className="h-7 w-7 text-cyan-200" strokeWidth={2.2} />
            <span className="font-bold">Skills checklists</span>
            <span className="text-xs text-white/65">Run a skill step by step, then log your sign-off.</span>
          </button>
          <button type="button" onClick={onOpenClinical} className="flex min-h-28 flex-col gap-2 rounded-3xl bg-white/[0.07] p-4 text-left ring-1 ring-white/10 focus-visible:outline-2 focus-visible:outline-rose-300">
            <Stethoscope aria-hidden className="h-7 w-7 text-rose-200" strokeWidth={2.2} />
            <span className="font-bold">Clinical day</span>
            <span className="text-xs text-white/65">Prep sheets and care plans in LPN scope.</span>
          </button>
        </div>
      </section>

      <section aria-labelledby="ngn-heading" className="flex flex-col gap-3">
        <h3 id="ngn-heading" className="flex items-center gap-2 text-lg font-bold">
          <Sparkles aria-hidden className="h-5 w-5 text-sky-200" strokeWidth={2.5} />
          NGN practice by stone
        </h3>
        {studied.length === 0 ? (
          <p className="text-sm text-white/65">Finish a lesson on your path and its Next Generation questions show up here.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {studied.slice(0, 30).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpenNgn({ id: s.id, title: s.title })}
                  className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-4 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-sky-300"
                >
                  <Layers aria-hidden className="h-4 w-4 shrink-0 text-sky-200" strokeWidth={2.5} />
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
