"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, CheckCircle2, PartyPopper, X, XCircle } from "lucide-react";
import type { BowtieAnswer, ChoiceView, CompleteResult, GradeResult, PracticeView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { haptic } from "@/lib/client/native";
import { togglePick } from "@/lib/quick-play";
import { cn } from "@/lib/cn";
import { GlossyButton } from "@/components/glass/GlossyButton";

// Tap-to-answer practice on the last story card. State lives in the lesson player so swiping back
// to an earlier card and returning doesn't lose answers.

export type QuickPlayState = {
  index: number;
  picks: Record<string, string[]>;
  bowtie: Record<string, BowtieAnswer>;
  results: Record<string, GradeResult>;
  checking: boolean;
  finishing: boolean;
  completion: CompleteResult | null;
  error: string | null;
};

export const EMPTY_QUICK_PLAY: QuickPlayState = {
  index: 0,
  picks: {},
  bowtie: {},
  results: {},
  checking: false,
  finishing: false,
  completion: null,
  error: null,
};

type QuickPlayProps = {
  stoneId: string;
  stoneTitle: string;
  items: PracticeView[];
  state: QuickPlayState;
  setState: React.Dispatch<React.SetStateAction<QuickPlayState>>;
  onDone: (result: CompleteResult) => void;
};

export function QuickPlay({ stoneId, stoneTitle, items, state, setState, onDone }: QuickPlayProps) {
  const item = items[state.index];

  const check = async () => {
    if (!item || state.checking) return;
    setState((s) => ({ ...s, checking: true, error: null }));
    try {
      const result = await api.attempt(
        item.type === "bowtie" ? { itemId: item.id, bowtie: state.bowtie[item.id] } : { itemId: item.id, selected: state.picks[item.id] ?? [] },
      );
      void haptic(result.correct ? "success" : "error");
      setState((s) => ({ ...s, checking: false, results: { ...s.results, [item.id]: result } }));
    } catch (error) {
      setState((s) => ({ ...s, checking: false, error: error instanceof Error ? error.message : "That didn't save. Try again." }));
    }
  };

  const finish = async () => {
    setState((s) => ({ ...s, finishing: true, error: null }));
    try {
      const completion = await api.complete(stoneId);
      setState((s) => ({ ...s, finishing: false, completion }));
    } catch (error) {
      setState((s) => ({ ...s, finishing: false, error: error instanceof Error ? error.message : "That didn't save. Try again." }));
    }
  };

  if (state.completion) return <Completion result={state.completion} stoneTitle={stoneTitle} onDone={() => onDone(state.completion!)} />;

  if (!item) {
    const right = items.filter((i) => state.results[i.id]?.correct).length;
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-5xl font-black">
          {right}
          <span className="text-2xl text-white/50"> / {items.length}</span>
        </p>
        <p className="text-lg text-white/80">{right === items.length ? "Perfect round!" : right / items.length >= 0.8 ? "Great job!" : "Good practice. Every miss teaches you something."}</p>
        {state.error && (
          <p role="alert" className="text-sm font-semibold text-rose-200">
            {state.error}
          </p>
        )}
        <GlossyButton variant="emerald" size="lg" onClick={finish} disabled={state.finishing}>
          {state.finishing ? "Saving..." : "Finish lesson"}
        </GlossyButton>
      </div>
    );
  }

  const result = state.results[item.id];
  const ready =
    item.type === "bowtie"
      ? Boolean(
          state.bowtie[item.id]?.condition &&
            state.bowtie[item.id]?.actions.length === item.actions.pick &&
            state.bowtie[item.id]?.parameters.length === item.parameters.pick,
        )
      : (state.picks[item.id]?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-emerald-200/80">
        <span>
          Question {state.index + 1} of {items.length}
        </span>
        <span>{item.origin === "uworld_twin" ? "Twin of your UWorld miss" : item.type === "bowtie" ? "NGN checkpoint" : "New question"}</span>
      </div>

      <motion.div
        key={item.id}
        animate={{
          boxShadow: result ? (result.correct ? "0 0 36px -6px rgba(52,211,153,0.7)" : "0 0 36px -6px rgba(244,63,94,0.7)") : "0 0 0 0 rgba(0,0,0,0)",
        }}
        className="relative flex flex-col gap-4 rounded-3xl"
      >
        <AnswerFlash result={result} />
        {item.type === "bowtie" ? (
          <BowtieItem item={item} result={result} state={state} setState={setState} />
        ) : (
          <ChoiceItem item={item} result={result} state={state} setState={setState} />
        )}
      </motion.div>

      {result && <Feedback result={result} />}
      {state.error && (
        <p role="alert" className="text-sm font-semibold text-rose-200">
          {state.error}
        </p>
      )}

      {result ? (
        <GlossyButton
          variant="emerald"
          size="lg"
          className="justify-center"
          onClick={() => setState((s) => ({ ...s, index: s.index + 1 }))}
          icon={<ArrowRight className="h-5 w-5" strokeWidth={2.5} />}
        >
          {state.index + 1 === items.length ? "See my score" : "Next"}
        </GlossyButton>
      ) : (
        <GlossyButton variant="blue" size="lg" className="justify-center" onClick={check} disabled={!ready || state.checking}>
          {state.checking ? "Checking..." : "Check"}
        </GlossyButton>
      )}
    </div>
  );
}

type ItemProps<T> = {
  item: T;
  result: GradeResult | undefined;
  state: QuickPlayState;
  setState: React.Dispatch<React.SetStateAction<QuickPlayState>>;
};

function ChoiceItem({ item, result, state, setState }: ItemProps<Extract<PracticeView, { type: "mcq" | "sata" }>>) {
  const picks = state.picks[item.id] ?? [];
  const limit = item.type === "sata" ? item.options.length : 1;
  return (
    <>
      <p className="text-lg font-semibold leading-snug">{item.stem}</p>
      {item.type === "sata" && <p className="text-sm font-bold text-amber-200">Select all that apply.</p>}
      <Options
        name={item.type === "sata" ? "Select all that apply" : "Pick one"}
        options={item.options}
        picks={picks}
        correctIds={result?.correctOptionIds}
        multiple={item.type === "sata"}
        disabled={Boolean(result)}
        onPick={(id) => setState((s) => ({ ...s, picks: { ...s.picks, [item.id]: togglePick(s.picks[item.id] ?? [], id, limit) } }))}
      />
    </>
  );
}

function BowtieItem({ item, result, state, setState }: ItemProps<Extract<PracticeView, { type: "bowtie" }>>) {
  const answer = state.bowtie[item.id] ?? { condition: "", actions: [], parameters: [] };
  const update = (patch: Partial<BowtieAnswer>) => setState((s) => ({ ...s, bowtie: { ...s.bowtie, [item.id]: { ...answer, ...patch } } }));
  return (
    <>
      <p className="text-lg font-semibold leading-snug">{item.scenario}</p>
      <BowtieSection
        step="1"
        title={item.condition.prompt}
        hint="Pick 1"
        options={item.condition.options}
        picks={answer.condition ? [answer.condition] : []}
        correctIds={result?.bowtie ? [result.bowtie.condition] : undefined}
        disabled={Boolean(result)}
        multiple={false}
        onPick={(id) => update({ condition: answer.condition === id ? "" : id })}
      />
      <BowtieSection
        step="2"
        title={item.actions.prompt}
        hint={`Pick ${item.actions.pick}`}
        options={item.actions.options}
        picks={answer.actions}
        correctIds={result?.bowtie?.actions}
        disabled={Boolean(result)}
        multiple
        onPick={(id) => update({ actions: togglePick(answer.actions, id, item.actions.pick) })}
      />
      <BowtieSection
        step="3"
        title={item.parameters.prompt}
        hint={`Pick ${item.parameters.pick}`}
        options={item.parameters.options}
        picks={answer.parameters}
        correctIds={result?.bowtie?.parameters}
        disabled={Boolean(result)}
        multiple
        onPick={(id) => update({ parameters: togglePick(answer.parameters, id, item.parameters.pick) })}
      />
    </>
  );
}

function BowtieSection({ step, title, hint, ...options }: { step: string; title: string; hint: string } & Omit<OptionsProps, "name">) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-white/[0.04] p-3">
      <p className="flex items-baseline gap-2 font-semibold leading-snug">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/25 text-xs font-bold text-emerald-100">{step}</span>
        <span>
          {title} <span className="text-sm font-bold text-amber-200">({hint})</span>
        </span>
      </p>
      <Options name={`${title} (${hint})`} {...options} />
    </div>
  );
}

type OptionsProps = {
  name: string;
  options: ChoiceView[];
  picks: string[];
  correctIds: string[] | undefined;
  multiple: boolean;
  disabled: boolean;
  onPick: (id: string) => void;
};

function Options({ name, options, picks, correctIds, multiple, disabled, onPick }: OptionsProps) {
  const reduceMotion = useReducedMotion();
  return (
    <div role={multiple ? "group" : "radiogroup"} aria-label={name} className="flex flex-col gap-2">
      {options.map((option) => {
        const picked = picks.includes(option.id);
        const isCorrect = correctIds?.includes(option.id);
        const graded = correctIds !== undefined;
        return (
          <motion.button
            key={option.id}
            type="button"
            role={multiple ? "checkbox" : "radio"}
            aria-checked={picked}
            disabled={disabled}
            onClick={() => {
              void haptic("tap");
              onPick(option.id);
            }}
            whileTap={disabled || reduceMotion ? undefined : { scale: 0.97 }}
            className={cn(
              "flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-base leading-snug transition-colors",
              "focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-default",
              !graded && (picked ? "border-sky-300/70 bg-sky-400/20" : "border-white/15 bg-white/[0.06]"),
              graded && isCorrect && "border-emerald-300/80 bg-emerald-400/25",
              graded && !isCorrect && picked && "border-rose-300/80 bg-rose-500/25",
              graded && !isCorrect && !picked && "border-white/10 bg-white/[0.03] text-white/50",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center text-sm font-bold",
                multiple ? "rounded-md" : "rounded-full",
                picked ? "bg-sky-300 text-on-accent" : "bg-white/10 text-white/80",
                graded && isCorrect && "bg-emerald-300 text-on-accent",
                graded && !isCorrect && picked && "bg-rose-400 text-on-accent",
              )}
            >
              {option.id}
            </span>
            <span className="flex-1">{option.text}</span>
            {graded && isCorrect && <CheckCircle2 aria-label="Correct answer" className="h-5 w-5 shrink-0 text-emerald-300" strokeWidth={2.5} />}
            {graded && !isCorrect && picked && <XCircle aria-label="Your answer, incorrect" className="h-5 w-5 shrink-0 text-rose-300" strokeWidth={2.5} />}
          </motion.button>
        );
      })}
    </div>
  );
}

function Feedback({ result }: { result: GradeResult }) {
  return (
    <div role="status" className={cn("rounded-2xl p-4", result.correct ? "bg-emerald-400/15" : "bg-rose-500/15")}>
      <p className={cn("text-lg font-bold", result.correct ? "text-emerald-200" : "text-rose-200")}>
        {result.correct ? "Correct!" : result.score > 0 ? `Partly right (${Math.round(result.score * 100)}%)` : "Not quite."}
      </p>
      <p className="mt-1 leading-snug text-white/85">{result.rationale}</p>
      {result.scopeNote && <p className="mt-2 text-sm leading-snug text-sky-200">LPN scope: {result.scopeNote}</p>}
    </div>
  );
}

// A green or red flash over the question the moment it's graded, with a big check or cross.
// The haptic buzz fires with it (in check()).
function AnswerFlash({ result }: { result: GradeResult | undefined }) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {result && (
        <motion.div
          key={result.attemptId}
          aria-hidden
          className={cn(
            "pointer-events-none absolute -inset-2 z-10 flex items-center justify-center rounded-3xl",
            result.correct ? "bg-emerald-400/30" : "bg-rose-500/30",
          )}
          initial={{ opacity: reduceMotion ? 0 : 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.9, ease: "easeOut" }}
        >
          <motion.span
            className={cn(
              "flex h-20 w-20 items-center justify-center rounded-full text-snow shadow-2xl",
              result.correct ? "bg-emerald-500" : "bg-rose-500",
            )}
            initial={{ scale: reduceMotion ? 1 : 0.4 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 18 }}
          >
            {result.correct ? <Check className="h-11 w-11" strokeWidth={3.5} /> : <X className="h-11 w-11" strokeWidth={3.5} />}
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Completion({ result, stoneTitle, onDone }: { result: CompleteResult; stoneTitle: string; onDone: () => void }) {
  if (result.mastered) return <MasteryCelebration result={result} stoneTitle={stoneTitle} onDone={onDone} />;
  return (
    <div className="flex flex-col items-center gap-4 text-center" role="status">
      <PartyPopper aria-hidden className="h-14 w-14 text-sky-300" strokeWidth={2.5} />
      <p className="text-2xl font-black">Lesson done</p>
      <p className="text-white/80">You scored {Math.round(result.score * 100)}%. Hit 80% to master it. Come back and try again anytime.</p>
      {result.unlockedStone && <p className="font-semibold text-sky-200">Next up: {result.unlockedStone.title}</p>}
      <GlossyButton variant="emerald" size="lg" onClick={onDone}>
        Back to my path
      </GlossyButton>
    </div>
  );
}

// The big moment: a full-screen overlay where the stone turns from blue to green, with confetti from both sides.
function MasteryCelebration({ result, stoneTitle, onDone }: { result: CompleteResult; stoneTitle: string; onDone: () => void }) {
  const reduceMotion = useReducedMotion();
  const fired = useRef(false);
  const [mounted, setMounted] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted) return;
    button.current?.focus();
    if (fired.current) return;
    fired.current = true;
    void haptic("celebrate");
    void import("canvas-confetti").then(({ default: confetti }) => {
      const colors = ["#38bdf8", "#34d399", "#a78bfa", "#fbbf24"];
      const burst = (x: number, angle: number) =>
        confetti({ particleCount: 90, spread: 70, angle, startVelocity: 55, origin: { x, y: 0.75 }, colors, disableForReducedMotion: true, zIndex: 90 });
      burst(0.1, 60);
      burst(0.9, 120);
      setTimeout(() => confetti({ particleCount: 120, spread: 120, origin: { y: 0.35 }, colors, disableForReducedMotion: true, zIndex: 90 }), 450);
    });
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${stoneTitle} mastered`}
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-6 bg-canvas/90 px-6 text-center backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="relative flex h-44 w-44 items-center justify-center">
        {!reduceMotion &&
          [0, 1, 2].map((i) => (
            <motion.span
              key={i}
              aria-hidden
              className="absolute inset-0 rounded-full border-4 border-emerald-300/60"
              initial={{ scale: 0.6, opacity: 0.9 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{ duration: 1.6, delay: 0.5 + i * 0.35, repeat: Infinity, repeatDelay: 0.4, ease: "easeOut" }}
            />
          ))}
        <motion.div
          aria-hidden
          className="relative flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border border-t-snow/50 border-l-snow/30 border-b-snow/5 border-r-snow/5 text-snow"
          initial={reduceMotion ? false : { scale: 0.7, boxShadow: "0 0 0 8px rgba(125,211,252,0.35), 0 0 40px 6px rgba(56,189,248,0.55)" }}
          animate={{ scale: 1, boxShadow: "0 0 0 8px rgba(110,231,183,0.35), 0 0 70px 14px rgba(52,211,153,0.6)" }}
          transition={{ duration: reduceMotion ? 0 : 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Blue (ready) underneath, green (mastered) fading in over it. */}
          <span className="absolute inset-0 bg-gradient-to-b from-sky-300 to-blue-600" />
          <motion.span
            className="absolute inset-0 bg-gradient-to-b from-emerald-300 to-emerald-600"
            initial={{ opacity: reduceMotion ? 1 : 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.8, delay: reduceMotion ? 0 : 0.3 }}
          />
          <span className="pointer-events-none absolute inset-x-5 top-2 h-1/3 rounded-full bg-gradient-to-b from-snow/50 to-transparent" />
          <motion.span
            initial={reduceMotion ? false : { scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 14, delay: reduceMotion ? 0 : 0.55 }}
            className="relative"
          >
            <Check className="h-16 w-16" strokeWidth={3.5} />
          </motion.span>
        </motion.div>
      </div>
      <motion.div
        className="flex flex-col items-center gap-2"
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduceMotion ? 0 : 0.7 }}
      >
        <p className="text-sm font-bold uppercase tracking-widest text-emerald-300">Stone mastered</p>
        <h2 className="text-3xl font-black leading-tight">{stoneTitle}</h2>
        <p className="text-lg text-white/80">{Math.round(result.score * 100)}% on Quick Play. It&apos;s glowing green on your path.</p>
        {result.unlockedStone && (
          <p className="mt-2 rounded-full bg-sky-400/15 px-4 py-2 font-semibold text-sky-200">Next up: {result.unlockedStone.title}</p>
        )}
      </motion.div>
      <GlossyButton ref={button} variant="emerald" size="lg" onClick={onDone}>
        Back to my path
      </GlossyButton>
    </motion.div>,
    document.body,
  );
}
