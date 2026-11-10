"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import type { CompleteResult, LessonView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { GlassStoryPlayer, type StoryCard } from "@/components/glass/GlassStoryPlayer";
import { EMPTY_QUICK_PLAY, QuickPlay, type QuickPlayState } from "./QuickPlay";

type LessonPlayerProps = {
  stone: { id: string; title: string } | null;
  onClose: () => void;
  onFinished: (result: CompleteResult) => void;
};

const BUILD_STEPS = ["Reading your chapter...", "Pulling in your notes...", "Checking your UWorld misses...", "Writing your Quick Play..."];

export function LessonPlayer({ stone, onClose, onFinished }: LessonPlayerProps) {
  const [lesson, setLesson] = useState<LessonView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quickPlay, setQuickPlay] = useState<QuickPlayState>(EMPTY_QUICK_PLAY);

  const load = useCallback(async (stoneId: string) => {
    setLesson(null);
    setError(null);
    setQuickPlay(EMPTY_QUICK_PLAY);
    try {
      setLesson(await api.lesson(stoneId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The lesson didn't load. Try again.");
    }
  }, []);

  useEffect(() => {
    if (stone) void load(stone.id);
    else {
      setLesson(null);
      setError(null);
    }
  }, [stone, load]);

  const cards: StoryCard[] = useMemo(() => {
    if (!lesson) return [];
    return lesson.cards.map((card) =>
      card.kind === "quick_play"
        ? {
            ...card,
            interactive: true,
            content: (
              <QuickPlay
                stoneId={lesson.stoneId}
                items={lesson.practice}
                state={quickPlay}
                setState={setQuickPlay}
                onDone={(result) => onFinished(result)}
              />
            ),
          }
        : card,
    );
  }, [lesson, quickPlay, onFinished]);

  const ready = Boolean(stone && lesson && lesson.stoneId === stone.id);

  return (
    <>
      <GlassStoryPlayer cards={cards} open={ready} onClose={onClose} onComplete={onClose} />
      <AnimatePresence>
        {stone && !ready && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Lesson: ${stone.title}`}
            className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#020617]/85 px-6 backdrop-blur-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))]">
              <GlossyButton size="icon" aria-label="Close lesson" onClick={onClose} icon={<X className="h-6 w-6" strokeWidth={2.5} />} />
            </div>
            {error ? (
              <GlassCard glow="ruby" role="alert" className="w-full max-w-md p-7 text-center">
                <p className="text-lg font-semibold">{error}</p>
                <div className="mt-5 flex justify-center gap-3">
                  <GlossyButton variant="ruby" onClick={() => void load(stone.id)}>
                    Try again
                  </GlossyButton>
                  <GlossyButton onClick={onClose}>Close</GlossyButton>
                </div>
              </GlassCard>
            ) : (
              <Building title={stone.title} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Building({ title }: { title: string }) {
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, BUILD_STEPS.length - 1)), 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <GlassCard glow="cyan" className="w-full max-w-md p-8 text-center" role="status" aria-live="polite">
      <motion.div
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300/40 to-violet-500/30"
        animate={reduceMotion ? undefined : { scale: [1, 1.12, 1], rotate: [0, 8, -8, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <Sparkles aria-hidden className="h-8 w-8 text-cyan-100" strokeWidth={2.5} />
      </motion.div>
      <h2 className="mt-5 text-2xl font-bold leading-tight">{title}</h2>
      <p className="mt-3 text-white/75">{BUILD_STEPS[step]}</p>
      <p className="mt-1 text-sm text-white/45">New lessons take about a minute. After that they open instantly.</p>
    </GlassCard>
  );
}
