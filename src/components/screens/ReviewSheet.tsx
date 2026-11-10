"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Layers, Loader2, RotateCcw, X } from "lucide-react";
import type { DeckCardView, LessonView, ReviewGrade, ReviewResult } from "@/lib/api-types";
import { api, deviceTimeZone } from "@/lib/client/api";
import { localDay } from "@/lib/study-math";
import { dueLabel } from "@/lib/ui/planner-format";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { EMPTY_QUICK_PLAY, QuickPlay, type QuickPlayState } from "./QuickPlay";

// A spaced review: first the student's own Anki cards for the stone that passed the fact-check, if any,
// then the stone's Quick Play questions again, no story cards. How many questions come out right sets
// when it's due next, and a poor round sends the stone back to the path to learn again.

type Props = {
  stone: { id: string; title: string } | null;
  onClose: () => void;
  // Called when a review was saved, so the Today card and path reload.
  onSaved: () => void;
  onRelearn: (stone: { id: string; title: string }) => void;
};

type Phase =
  | { kind: "loading" }
  | { kind: "cards"; lesson: LessonView; cards: DeckCardView[] }
  | { kind: "playing"; lesson: LessonView; startedAt: string }
  | { kind: "saving" }
  | { kind: "done"; result: ReviewResult }
  | { kind: "error"; message: string; retry: "load" | "save" };

const GRADE: Record<ReviewGrade, { title: string; note: string }> = {
  easy: { title: "Locked in", note: "Every answer right. It comes back much later." },
  good: { title: "Still solid", note: "Next review is further out." },
  hard: { title: "A bit shaky", note: "It comes back a little sooner." },
  again: { title: "This one slipped", note: "It's back on your path to learn again." },
};

export function ReviewSheet({ stone, onClose, onSaved, onRelearn }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [play, setPlay] = useState<QuickPlayState>(EMPTY_QUICK_PLAY);
  const startedAt = useRef<string | null>(null);

  const load = useCallback(async (id: string) => {
    setPhase({ kind: "loading" });
    setPlay(EMPTY_QUICK_PLAY);
    try {
      const [lesson, cards] = await Promise.all([api.lesson(id), api.stoneCards(id).then((r) => r.cards, () => [] as DeckCardView[])]);
      if (!lesson.practice.length) {
        setPhase({ kind: "error", message: "This lesson has no questions to review yet.", retry: "load" });
        return;
      }
      if (cards.length) {
        setPhase({ kind: "cards", lesson, cards });
        return;
      }
      startedAt.current = new Date().toISOString();
      setPhase({ kind: "playing", lesson, startedAt: startedAt.current });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "The review didn't load. Try again.", retry: "load" });
    }
  }, []);

  useEffect(() => {
    if (stone) void load(stone.id);
  }, [stone, load]);

  const save = useCallback(async () => {
    if (!stone || !startedAt.current) return;
    setPhase({ kind: "saving" });
    try {
      const result = await api.review(stone.id, startedAt.current);
      setPhase({ kind: "done", result });
      onSaved();
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "The review didn't save. Try again.", retry: "save" });
    }
  }, [stone, onSaved]);

  return (
    <AnimatePresence>
      {stone && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Review: ${stone.title}`}
          className="fixed inset-0 z-[60] flex flex-col bg-canvas/95 px-4 pb-[max(1.5rem,var(--safe-bottom))] pt-[max(1rem,var(--safe-top))] backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 text-sm font-bold uppercase tracking-wide text-amber-200">
              <RotateCcw aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.5} />
              <span className="truncate">Review: {stone.title}</span>
            </p>
            <GlossyButton size="icon" onClick={onClose} aria-label="Close review" icon={<X className="h-6 w-6" strokeWidth={2.5} />} />
          </div>
          <div className="mx-auto mt-4 w-full max-w-md flex-1 overflow-y-auto overscroll-contain">
            <GlassCard glow="amber" className="p-6">
              {(phase.kind === "loading" || phase.kind === "saving") && (
                <div className="flex flex-col items-center gap-3 py-6 text-center" role="status" aria-live="polite">
                  <Loader2 aria-hidden className="h-10 w-10 animate-spin text-amber-200" strokeWidth={2.5} />
                  <p className="font-semibold">{phase.kind === "loading" ? "Getting your questions..." : "Saving your review..."}</p>
                </div>
              )}
              {phase.kind === "cards" && (
                <DeckFlashcards
                  cards={phase.cards}
                  onDone={() => {
                    startedAt.current = new Date().toISOString();
                    setPhase({ kind: "playing", lesson: phase.lesson, startedAt: startedAt.current });
                  }}
                />
              )}
              {phase.kind === "playing" && (
                <QuickPlay
                  stoneId={stone.id}
                  stoneTitle={stone.title}
                  items={phase.lesson.practice}
                  state={play}
                  setState={setPlay}
                  onDone={onClose}
                  onRoundDone={() => void save()}
                />
              )}
              {phase.kind === "error" && (
                <div className="flex flex-col items-center gap-4 text-center" role="alert">
                  <p className="text-lg font-semibold">{phase.message}</p>
                  <div className="flex gap-3">
                    <GlossyButton variant="amber" onClick={() => (phase.retry === "save" ? void save() : void load(stone.id))}>
                      Try again
                    </GlossyButton>
                    <GlossyButton onClick={onClose}>Close</GlossyButton>
                  </div>
                </div>
              )}
              {phase.kind === "done" && (
                <div className="flex flex-col items-center gap-3 text-center" role="status">
                  <p className="text-5xl font-black">
                    {phase.result.correct}
                    <span className="text-2xl text-white/50"> / {phase.result.answered}</span>
                  </p>
                  <p className="text-xl font-bold">{GRADE[phase.result.grade].title}</p>
                  <p className="text-white/75">{GRADE[phase.result.grade].note}</p>
                  {phase.result.status === "mastered" ? (
                    <p className="text-sm font-semibold text-amber-200">Next review: {dueLabel(phase.result.dueOn, localDay(new Date(), deviceTimeZone() ?? "UTC"))}</p>
                  ) : null}
                  <div className="mt-2 flex gap-3">
                    {phase.result.status === "needs_review" && (
                      <GlossyButton variant="ruby" onClick={() => onRelearn(stone)}>
                        Learn it again
                      </GlossyButton>
                    )}
                    <GlossyButton variant={phase.result.status === "mastered" ? "emerald" : "glass"} onClick={onClose}>
                      Done
                    </GlossyButton>
                  </div>
                </div>
              )}
            </GlassCard>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// The stone's Anki cards, one at a time: think of the answer, tap to see it, then move on.
function DeckFlashcards({ cards, onDone }: { cards: DeckCardView[]; onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const card = cards[index];
  const last = index === cards.length - 1;
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-200">
        <Layers aria-hidden className="h-4 w-4" strokeWidth={2.5} />
        Your Anki cards · {index + 1} of {cards.length}
      </p>
      <button
        type="button"
        onClick={() => setShown(true)}
        aria-label={shown ? undefined : "Show the answer"}
        className="min-h-40 rounded-3xl bg-white/[0.06] p-5 text-left focus-visible:outline-2 focus-visible:outline-amber-300"
      >
        <p className="whitespace-pre-line text-lg font-bold leading-snug">{card.front}</p>
        {shown ? (
          <p className="mt-4 whitespace-pre-line border-t border-white/15 pt-4 text-white/85" aria-live="polite">
            {card.back}
          </p>
        ) : (
          <p className="mt-4 text-sm text-white/50">Think of the answer, then tap to check.</p>
        )}
      </button>
      <div className="flex gap-3">
        <GlossyButton
          variant="amber"
          onClick={() => {
            if (last) onDone();
            else {
              setIndex(index + 1);
              setShown(false);
            }
          }}
        >
          {last ? "On to the questions" : "Next card"}
        </GlossyButton>
        {!last && <GlossyButton onClick={onDone}>Skip to questions</GlossyButton>}
      </div>
    </div>
  );
}
