"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "framer-motion";
import { AlertTriangle, Baby, BookOpenText, ChevronLeft, Gamepad2, Stethoscope, Volume2, VolumeX, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { speak, speechAvailable, stopSpeaking } from "@/lib/client/native";
import { GlassCard, type GlowColor } from "./GlassCard";
import { GlossyButton } from "./GlossyButton";

export type StoryCardKind = "eli10" | "lpn_core" | "exam_alert" | "notebooklm" | "quick_play";

export type StoryCard = {
  id: string;
  kind: StoryCardKind;
  title: string;
  bullets?: string[];
  body?: string;
  content?: React.ReactNode;
  // Cards with their own buttons (Quick Play) turn off swiping and the tap-the-sides zones.
  interactive?: boolean;
};

const KIND_META: Record<StoryCardKind, { label: string; glow: GlowColor; bar: string; Icon: typeof Baby; tint: string }> = {
  eli10: { label: "Explain Like I'm 10", glow: "cyan", bar: "bg-cyan-300", Icon: Baby, tint: "text-cyan-300" },
  lpn_core: { label: "The LPN Core", glow: "blue", bar: "bg-sky-400", Icon: Stethoscope, tint: "text-sky-300" },
  exam_alert: { label: "HESI Hint & NCLEX Alert", glow: "amber", bar: "bg-amber-300", Icon: AlertTriangle, tint: "text-amber-300" },
  notebooklm: { label: "From Your NotebookLM", glow: "violet", bar: "bg-violet-400", Icon: BookOpenText, tint: "text-violet-300" },
  quick_play: { label: "Quick Play", glow: "emerald", bar: "bg-emerald-400", Icon: Gamepad2, tint: "text-emerald-300" },
};

const MAX_BULLETS = 3;
const SWIPE_DISTANCE = 80;
const SWIPE_VELOCITY = 400;

function cardSpeech(card: StoryCard) {
  return [card.title, card.body, ...(card.bullets ?? []).slice(0, MAX_BULLETS)].filter(Boolean).join(". ");
}

type GlassStoryPlayerProps = {
  cards: StoryCard[];
  open: boolean;
  onClose: () => void;
  onComplete?: () => void;
  initialIndex?: number;
};

export function GlassStoryPlayer({ cards, open, onClose, onComplete, initialIndex = 0 }: GlassStoryPlayerProps) {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(initialIndex);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [speaking, setSpeaking] = useState(false);
  const canSpeak = speechAvailable();
  // Bumped on every start/stop so a finished older reading can't flip the button back.
  const speechRun = useRef(0);

  const stopSpeech = useCallback(() => {
    speechRun.current += 1;
    if (canSpeak) void stopSpeaking();
    setSpeaking(false);
  }, [canSpeak]);

  const go = useCallback(
    (step: 1 | -1) => {
      const next = index + step;
      if (next < 0) return;
      stopSpeech();
      if (next >= cards.length) {
        onComplete?.();
        return;
      }
      setDirection(step);
      setIndex(next);
    },
    [index, cards.length, onComplete, stopSpeech],
  );

  useEffect(() => {
    if (open) setIndex(Math.min(initialIndex, Math.max(cards.length - 1, 0)));
    else stopSpeech();
  }, [open, initialIndex, cards.length, stopSpeech]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go, onClose]);

  useEffect(() => stopSpeech, [stopSpeech]);

  const card = cards[index];

  const toggleSpeech = () => {
    if (!canSpeak || !card) return;
    if (speaking) {
      stopSpeech();
      return;
    }
    const run = ++speechRun.current;
    setSpeaking(true);
    const done = () => {
      if (speechRun.current === run) setSpeaking(false);
    };
    speak(cardSpeech(card)).then(done, done);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE_DISTANCE || info.velocity.x < -SWIPE_VELOCITY) go(1);
    else if (info.offset.x > SWIPE_DISTANCE || info.velocity.x > SWIPE_VELOCITY) go(-1);
  };

  return (
    <AnimatePresence>
      {open && card && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Lesson"
          className="fixed inset-0 z-[60] flex flex-col bg-[#020617]/80 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="mx-auto flex w-full max-w-md gap-1.5" aria-hidden>
            {cards.map((c, i) => (
              <div key={c.id} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15">
                <motion.div
                  className={cn("h-full rounded-full", KIND_META[c.kind].bar)}
                  initial={false}
                  animate={{ width: i <= index ? "100%" : "0%" }}
                  transition={{ duration: reduceMotion ? 0 : 0.35 }}
                />
              </div>
            ))}
          </div>

          <div className="mx-auto mt-4 flex w-full max-w-md items-center justify-between">
            <GlossyButton
              size="md"
              onClick={toggleSpeech}
              disabled={!canSpeak}
              aria-pressed={speaking}
              icon={speaking ? <VolumeX className="h-5 w-5" strokeWidth={2.5} /> : <Volume2 className="h-5 w-5" strokeWidth={2.5} />}
            >
              {speaking ? "Stop" : "Listen"}
            </GlossyButton>
            <p className="text-sm font-semibold text-white/60" aria-live="polite">
              {index + 1} / {cards.length}
            </p>
            <GlossyButton size="icon" onClick={onClose} aria-label="Close lesson" icon={<X className="h-6 w-6" strokeWidth={2.5} />} />
          </div>

          <div className="relative mx-auto mt-3 flex min-h-0 w-full max-w-[calc(28rem+2rem)] flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-3">
            {!card.interactive && (
              <>
                <button type="button" aria-label="Previous card" onClick={() => go(-1)} className="absolute inset-y-0 left-0 z-10 w-1/5" />
                <button type="button" aria-label="Next card" onClick={() => go(1)} className="absolute inset-y-0 right-0 z-10 w-1/5" />
              </>
            )}

            <AnimatePresence mode="popLayout" custom={direction} initial={false}>
              <motion.div
                key={card.id}
                custom={direction}
                className="my-auto w-full py-1"
                drag={reduceMotion || card.interactive ? false : "x"}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.6}
                onDragEnd={onDragEnd}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: direction * 120, rotate: direction * 4 }}
                animate={{ opacity: 1, x: 0, rotate: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: direction * -120, rotate: direction * -4 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              >
                <StoryCardView card={card} />
              </motion.div>
            </AnimatePresence>
          </div>

          {card.interactive ? (
            <div className="mx-auto mt-3 flex w-full max-w-md">
              <GlossyButton size="md" onClick={() => go(-1)} icon={<ChevronLeft className="h-5 w-5" strokeWidth={2.5} />}>
                Back
              </GlossyButton>
            </div>
          ) : (
            <p className="mx-auto mt-4 text-center text-xs text-white/40">Swipe or tap the sides</p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StoryCardView({ card }: { card: StoryCard }) {
  const meta = KIND_META[card.kind];
  const bullets = (card.bullets ?? []).slice(0, MAX_BULLETS);

  return (
    <GlassCard glow={meta.glow} className={cn("p-7", card.interactive ? "min-h-0" : "min-h-[55dvh]")}>
      <div className={cn("flex items-center gap-2 text-sm font-bold uppercase tracking-wide", meta.tint)}>
        <meta.Icon aria-hidden className="h-5 w-5" strokeWidth={2.5} />
        {meta.label}
      </div>
      <h2 className="mt-4 text-2xl font-bold leading-tight text-white">{card.title}</h2>
      {card.body && <p className="mt-4 text-lg leading-relaxed text-white/85">{card.body}</p>}
      {bullets.length > 0 && (
        <ul className="mt-5 space-y-4">
          {bullets.map((b) => (
            <li key={b} className="flex gap-3 text-lg leading-snug text-white/90">
              <span aria-hidden className={cn("mt-2 h-2.5 w-2.5 shrink-0 rounded-full", meta.bar)} />
              {b}
            </li>
          ))}
        </ul>
      )}
      {card.content && <div className="mt-5">{card.content}</div>}
    </GlassCard>
  );
}
