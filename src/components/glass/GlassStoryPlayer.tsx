"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "framer-motion";
import { AlertTriangle, Baby, BookOpenText, ChevronLeft, ChevronRight, Gamepad2, MessageCircleQuestion, Stethoscope, Volume2, VolumeX, X } from "lucide-react";
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
  // Where the card came from, in small print under it ("Foundations, pp. 41-43").
  caption?: string;
  content?: React.ReactNode;
  // Cards with their own buttons (Quick Play) turn off swiping and the tap-the-sides zones.
  interactive?: boolean;
};

// Each card type has its own accent: glow, top edge, a soft wash of color, its label chip and bullet dots.
const KIND_META: Record<
  StoryCardKind,
  { label: string; glow: GlowColor; bar: string; Icon: typeof Baby; tint: string; chip: string; edge: string; wash: string }
> = {
  eli10: {
    label: "Explain Like I'm 10",
    glow: "cyan",
    bar: "bg-cyan-300",
    Icon: Baby,
    tint: "text-cyan-300",
    chip: "bg-cyan-400/15",
    edge: "border-t-cyan-300/70",
    wash: "bg-gradient-to-b from-cyan-400/[0.14] via-transparent to-transparent",
  },
  lpn_core: {
    label: "The LPN Core",
    glow: "blue",
    bar: "bg-sky-400",
    Icon: Stethoscope,
    tint: "text-sky-300",
    chip: "bg-sky-400/15",
    edge: "border-t-sky-300/70",
    wash: "bg-gradient-to-b from-sky-400/[0.14] via-transparent to-transparent",
  },
  exam_alert: {
    label: "HESI Hint & NCLEX Alert",
    glow: "amber",
    bar: "bg-amber-300",
    Icon: AlertTriangle,
    tint: "text-amber-300",
    chip: "bg-amber-300/15",
    edge: "border-t-amber-300/70",
    wash: "bg-gradient-to-b from-amber-300/[0.14] via-transparent to-transparent",
  },
  notebooklm: {
    label: "From Your NotebookLM",
    glow: "violet",
    bar: "bg-violet-400",
    Icon: BookOpenText,
    tint: "text-violet-300",
    chip: "bg-violet-400/15",
    edge: "border-t-violet-300/70",
    wash: "bg-gradient-to-b from-violet-400/[0.16] via-transparent to-transparent",
  },
  quick_play: {
    label: "Quick Play",
    glow: "emerald",
    bar: "bg-emerald-400",
    Icon: Gamepad2,
    tint: "text-emerald-300",
    chip: "bg-emerald-400/15",
    edge: "border-t-emerald-300/70",
    wash: "bg-gradient-to-b from-emerald-400/[0.14] via-transparent to-transparent",
  },
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
  // Show the "Swipe or tap the sides" hint (only for a student's first few lessons).
  showHint?: boolean;
  // Open as the right-hand pane of a two-pane layout instead of over the whole screen.
  pane?: boolean;
  // Shows an "Ask" button on reading cards; the player stays put while the question sheet is open.
  onAsk?: (card: StoryCard) => void;
  // True while something covers the player (the Ask sheet): its keys and swipes wait.
  paused?: boolean;
};

export function GlassStoryPlayer({ cards, open, onClose, onComplete, initialIndex = 0, showHint = true, pane = false, onAsk, paused = false }: GlassStoryPlayerProps) {
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
    if (!open || paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, paused, go, onClose]);

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
          aria-modal={pane ? undefined : true}
          aria-label="Lesson"
          className={cn(
            "fixed z-[60] flex flex-col bg-canvas/95 px-4 pb-[max(1.5rem,var(--safe-bottom))] pt-[max(1rem,var(--safe-top))] backdrop-blur-xl",
            pane ? "inset-y-0 right-0 w-1/2 border-l border-white/10" : "inset-0",
          )}
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
            <div className="flex items-center gap-2">
              {onAsk && !card.interactive && (
                <GlossyButton
                  size="md"
                  onClick={() => {
                    stopSpeech();
                    onAsk(card);
                  }}
                  aria-label={`Ask about this card: ${card.title}`}
                  icon={<MessageCircleQuestion className="h-5 w-5" strokeWidth={2.5} />}
                >
                  Ask
                </GlossyButton>
              )}
              <GlossyButton size="icon" onClick={onClose} aria-label="Close lesson" icon={<X className="h-6 w-6" strokeWidth={2.5} />} />
            </div>
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
          ) : showHint ? (
            <p className="mx-auto mt-4 flex min-h-11 items-center gap-2 text-center text-sm font-semibold text-white/75">
              <ChevronLeft aria-hidden className="h-4 w-4" strokeWidth={2.5} />
              Swipe or tap the sides
              <ChevronRight aria-hidden className="h-4 w-4" strokeWidth={2.5} />
            </p>
          ) : (
            <div aria-hidden className="mt-4 min-h-11" />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StoryCardView({ card }: { card: StoryCard }) {
  const meta = KIND_META[card.kind];
  const bullets = (card.bullets ?? []).slice(0, MAX_BULLETS);

  // Cards size to their content. A short one gets a large, faint picture of its card type so it doesn't look empty.
  return (
    <GlassCard
      glow={meta.glow}
      className={cn("overflow-hidden p-7", meta.edge, meta.wash, !card.interactive && "min-h-[19rem]")}
      decoration={
        !card.interactive && (
          <meta.Icon aria-hidden className={cn("pointer-events-none absolute -bottom-8 -right-8 h-48 w-48 opacity-[0.09]", meta.tint)} strokeWidth={1.5} />
        )
      }
    >
      <div className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold uppercase tracking-wide", meta.tint, meta.chip)}>
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
      {card.caption && <p className="mt-5 text-xs font-semibold text-white/55">{card.caption}</p>}
    </GlassCard>
  );
}
