"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import type { CompleteResult, LessonView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { bumpCount, readCount, shouldShowSwipeHint, SWIPE_HINT_KEY } from "@/lib/client/prefs";
import { cn } from "@/lib/cn";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { GlassStoryPlayer, type StoryCard } from "@/components/glass/GlassStoryPlayer";
import { EMPTY_QUICK_PLAY, QuickPlay, type QuickPlayState } from "./QuickPlay";

type LessonPlayerProps = {
  stone: { id: string; title: string } | null;
  // Wide screens: open as the right-hand pane beside the path.
  pane?: boolean;
  onClose: () => void;
  onFinished: (result: CompleteResult) => void;
};

const BUILD_STEPS = ["Reading your chapter...", "Pulling in your notes...", "Checking your UWorld misses...", "Writing your Quick Play..."];

export function LessonPlayer({ stone, pane = false, onClose, onFinished }: LessonPlayerProps) {
  const [lesson, setLesson] = useState<LessonView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quickPlay, setQuickPlay] = useState<QuickPlayState>(EMPTY_QUICK_PLAY);
  const [showHint, setShowHint] = useState(true);

  // The swipe hint shows for the first few lessons, then gets out of the way.
  const stoneId = stone?.id;
  useEffect(() => {
    if (!stoneId) return;
    setShowHint(shouldShowSwipeHint(readCount(SWIPE_HINT_KEY)));
    bumpCount(SWIPE_HINT_KEY);
  }, [stoneId]);

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
                stoneTitle={lesson.stoneTitle}
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
      <GlassStoryPlayer cards={cards} open={ready} onClose={onClose} onComplete={onClose} showHint={showHint} pane={pane} />
      <AnimatePresence>
        {stone && !ready && (
          <motion.div
            role="dialog"
            aria-modal={pane ? undefined : true}
            aria-label={`Lesson: ${stone.title}`}
            className={cn(
              "fixed z-[60] flex flex-col items-center justify-center bg-canvas/95 px-6 backdrop-blur-xl",
              pane ? "inset-y-0 right-0 w-1/2 border-l border-white/10" : "inset-0",
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute right-4 top-[max(1rem,var(--safe-top))]">
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

// While a new lesson is written: a shimmering placeholder of the story card, with what's happening under it.
function Building({ title }: { title: string }) {
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, BUILD_STEPS.length - 1)), 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex w-full max-w-md flex-col gap-4" role="status" aria-live="polite" aria-label={`Writing your lesson: ${title}. ${BUILD_STEPS[step]}`}>
      <div className="flex gap-1.5" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="shimmer h-1.5 flex-1 rounded-full" />
        ))}
      </div>
      <GlassCard glow="cyan" className="min-h-[19rem] p-7" aria-hidden>
        <div className="shimmer h-8 w-44 rounded-full" />
        <div className="shimmer mt-5 h-7 w-4/5 rounded-xl" />
        <div className="mt-6 space-y-4">
          {["w-full", "w-11/12", "w-3/4"].map((w) => (
            <div key={w} className="flex items-center gap-3">
              <div className="shimmer h-2.5 w-2.5 shrink-0 rounded-full" />
              <div className={cn("shimmer h-5 rounded-lg", w)} />
            </div>
          ))}
        </div>
      </GlassCard>
      <div className="flex items-center justify-center gap-3 text-center">
        <motion.span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300/40 to-violet-500/30"
          animate={reduceMotion ? undefined : { rotate: [0, 12, -12, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <Sparkles className="h-5 w-5 text-cyan-100" strokeWidth={2.5} />
        </motion.span>
        <div className="text-left">
          <p className="font-bold leading-tight">{title}</p>
          <p className="text-sm text-white/75">{BUILD_STEPS[step]}</p>
        </div>
      </div>
      <p className="text-center text-xs text-white/55">New lessons take about a minute. After that they open instantly.</p>
    </div>
  );
}
