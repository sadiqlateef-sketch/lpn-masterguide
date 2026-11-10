"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Gamepad2, Timer, X } from "lucide-react";
import type { GameAnswer, GameResult, GameRound, GameSummary } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { haptic } from "@/lib/client/native";
import { cn } from "@/lib/cn";
import { moveItem } from "@/lib/quick-play";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { EndingQuestions } from "./Ending";
import { Busy, errorText, FullSheet, Problem } from "./FullSheet";

// One round of a learning game: play it, see what was right and why, then answer the NCLEX-style
// questions that close every round.

type Phase =
  | { kind: "loading" }
  | { kind: "playing"; round: GameRound; startedAt: number }
  | { kind: "checking"; round: GameRound }
  | { kind: "result"; round: GameRound; result: GameResult }
  | { kind: "ending"; round: GameRound; result: GameResult }
  | { kind: "error"; message: string; retry: () => void };

type Props = { game: GameSummary | null; onClose: () => void; onPlayed: () => void };

export function GameSheet({ game, onClose, onPlayed }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [answer, setAnswer] = useState<GameAnswer>({});

  const start = useCallback(async (g: GameSummary) => {
    setPhase({ kind: "loading" });
    setAnswer({});
    try {
      const round = await api.startRound(g.id);
      if (round.view.kind === "order") setAnswer({ order: round.view.items.map((i) => i.id) });
      setPhase({ kind: "playing", round, startedAt: Date.now() });
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e, "The round didn't load. Try again."), retry: () => void start(g) });
    }
  }, []);

  useEffect(() => {
    if (game) void start(game);
  }, [game, start]);

  const submit = useCallback(
    async (round: GameRound, startedAt: number, given: GameAnswer) => {
      setPhase({ kind: "checking", round });
      try {
        const result = await api.answerRound(round.roundId, given, Date.now() - startedAt);
        void haptic(result.pct >= 80 ? "success" : "error");
        setPhase({ kind: "result", round, result });
        onPlayed();
      } catch (e) {
        setPhase({ kind: "error", message: errorText(e, "Your round didn't save. Try again."), retry: () => void submit(round, startedAt, given) });
      }
    },
    [onPlayed],
  );

  return (
    <FullSheet open={game !== null} title={game?.title ?? "Game"} icon={<Gamepad2 />} tone="text-violet-200" onClose={onClose}>
      <GlassCard glow="violet" className="p-6">
        {phase.kind === "loading" && <Busy label="Setting up your round..." />}
        {phase.kind === "checking" && <Busy label="Checking your round..." />}
        {phase.kind === "error" && <Problem message={phase.message} onRetry={phase.retry} onClose={onClose} />}
        {phase.kind === "playing" && (
          <Playing round={phase.round} startedAt={phase.startedAt} answer={answer} setAnswer={setAnswer} onSubmit={(given) => void submit(phase.round, phase.startedAt, given)} />
        )}
        {phase.kind === "result" && (
          <RoundResult
            result={phase.result}
            onEnding={() => setPhase({ kind: "ending", round: phase.round, result: phase.result })}
            onAgain={() => game && void start(game)}
            onClose={onClose}
          />
        )}
        {phase.kind === "ending" && (
          <EndingQuestions
            title="Close the round: NCLEX-style questions"
            items={phase.result.ending}
            onDone={() => setPhase({ kind: "result", round: phase.round, result: { ...phase.result, ending: [] } })}
          />
        )}
      </GlassCard>
    </FullSheet>
  );
}

function Playing({
  round,
  startedAt,
  answer,
  setAnswer,
  onSubmit,
}: {
  round: GameRound;
  startedAt: number;
  answer: GameAnswer;
  setAnswer: React.Dispatch<React.SetStateAction<GameAnswer>>;
  onSubmit: (given: GameAnswer) => void;
}) {
  const view = round.view;
  const ready =
    view.kind === "match"
      ? Object.keys(answer.match ?? {}).length === view.left.length
      : view.kind === "bins"
        ? Object.keys(answer.bins ?? {}).length === view.cards.length
        : view.kind === "order"
          ? (answer.order?.length ?? 0) === view.items.length
          : view.problems.some((p) => answer.calc?.[p.id]?.trim());

  // A speed round hands in what's there when the time runs out.
  const latest = useRef(answer);
  latest.current = answer;
  const submitted = useRef(false);
  const handIn = useCallback(
    (given: GameAnswer) => {
      if (submitted.current) return;
      submitted.current = true;
      onSubmit(given);
    },
    [onSubmit],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-lg font-bold leading-snug">{view.prompt}</p>
        {round.timeLimitSeconds !== null && <Countdown seconds={round.timeLimitSeconds} startedAt={startedAt} onTimeUp={() => handIn(latest.current)} />}
      </div>
      {round.stones.length > 0 && <p className="text-xs text-white/55">From: {round.stones.map((s) => s.title).join(", ")}</p>}

      {view.kind === "match" && <MatchBoard left={view.left} right={view.right} pairs={answer.match ?? {}} onChange={(match) => setAnswer({ match })} />}
      {view.kind === "bins" && <BinsBoard bins={view.bins} cards={view.cards} placed={answer.bins ?? {}} onChange={(bins) => setAnswer({ bins })} />}
      {view.kind === "order" && <OrderBoard items={view.items} order={answer.order ?? view.items.map((i) => i.id)} onChange={(order) => setAnswer({ order })} />}
      {view.kind === "calc" && <CalcBoard problems={view.problems} typed={answer.calc ?? {}} onChange={(calc) => setAnswer({ calc })} />}

      <GlossyButton variant="violet" size="lg" className="justify-center" disabled={!ready} onClick={() => handIn(answer)}>
        Check my round
      </GlossyButton>
    </div>
  );
}

function Countdown({ seconds, startedAt, onTimeUp }: { seconds: number; startedAt: number; onTimeUp: () => void }) {
  const [left, setLeft] = useState(seconds);
  const timeUp = useRef(onTimeUp);
  timeUp.current = onTimeUp;
  useEffect(() => {
    const tick = () => {
      const remaining = Math.max(0, seconds - Math.floor((Date.now() - startedAt) / 1000));
      setLeft(remaining);
      if (remaining === 0) timeUp.current();
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [seconds, startedAt]);
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, "0");
  return (
    <span
      role="timer"
      aria-label={`${m} minutes ${left % 60} seconds left`}
      className={cn("flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-sm font-bold tabular-nums", left <= 30 ? "bg-rose-500/25 text-rose-100" : "bg-white/10 text-white/85")}
    >
      <Timer aria-hidden className="h-4 w-4" strokeWidth={2.5} />
      {m}:{s}
    </span>
  );
}

// Tap a left card, then the right card that goes with it. Each pair shares a number.
function MatchBoard({
  left,
  right,
  pairs,
  onChange,
}: {
  left: { id: string; text: string }[];
  right: { id: string; text: string }[];
  pairs: Record<string, string>;
  onChange: (pairs: Record<string, string>) => void;
}) {
  const [picked, setPicked] = useState<string | null>(left[0]?.id ?? null);
  const numberOf = (leftId: string) => left.findIndex((l) => l.id === leftId) + 1;
  const pairedLeftFor = (rightId: string) => Object.entries(pairs).find(([, r]) => r === rightId)?.[0] ?? null;

  const pickRight = (rightId: string) => {
    if (!picked) return;
    const next = Object.fromEntries(Object.entries(pairs).filter(([l, r]) => l !== picked && r !== rightId));
    next[picked] = rightId;
    onChange(next);
    void haptic("tap");
    setPicked(left.find((l) => !next[l.id])?.id ?? null);
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <ul className="flex flex-col gap-2" aria-label="Pick one">
        {left.map((l, i) => (
          <li key={l.id}>
            <button
              type="button"
              aria-pressed={picked === l.id}
              onClick={() => setPicked(l.id)}
              className={cn(
                "flex min-h-14 w-full items-center gap-2 rounded-2xl p-3 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-violet-300",
                picked === l.id ? "bg-violet-500/35 ring-2 ring-violet-300" : pairs[l.id] ? "bg-white/[0.12]" : "bg-white/[0.06]",
              )}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-400/40 text-xs">{i + 1}</span>
              {l.text}
            </button>
          </li>
        ))}
      </ul>
      <ul className="flex flex-col gap-2" aria-label="Then its match">
        {right.map((r) => {
          const owner = pairedLeftFor(r.id);
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => pickRight(r.id)}
                disabled={!picked}
                aria-label={owner ? `${r.text}, paired with ${numberOf(owner)}` : r.text}
                className={cn(
                  "flex min-h-14 w-full items-center gap-2 rounded-2xl p-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-violet-300 disabled:opacity-60",
                  owner ? "bg-white/[0.12]" : "bg-white/[0.06]",
                )}
              >
                {owner && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-400/40 text-xs font-bold">{numberOf(owner)}</span>}
                {r.text}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Each card goes in one bin.
function BinsBoard({
  bins,
  cards,
  placed,
  onChange,
}: {
  bins: { id: string; text: string }[];
  cards: { id: string; text: string }[];
  placed: Record<string, string>;
  onChange: (placed: Record<string, string>) => void;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {cards.map((c) => (
        <li key={c.id} className="rounded-2xl bg-white/[0.06] p-3">
          <p className="font-semibold leading-snug">{c.text}</p>
          <div role="radiogroup" aria-label={c.text} className="mt-2 flex flex-wrap gap-2">
            {bins.map((b) => {
              const on = placed[c.id] === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    onChange({ ...placed, [c.id]: b.id });
                    void haptic("tap");
                  }}
                  className={cn(
                    "min-h-11 rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-violet-300",
                    on ? "bg-violet-500/50 text-white ring-2 ring-violet-300" : "bg-white/10 text-white/80",
                  )}
                >
                  {b.text}
                </button>
              );
            })}
          </div>
        </li>
      ))}
    </ul>
  );
}

function OrderBoard({ items, order, onChange }: { items: { id: string; text: string }[]; order: string[]; onChange: (order: string[]) => void }) {
  const text = (id: string) => items.find((i) => i.id === id)?.text ?? id;
  return (
    <ol className="flex flex-col gap-2">
      {order.map((id, i) => (
        <li key={id} className="flex items-center gap-2 rounded-2xl bg-white/[0.06] p-2 pl-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-400/40 text-sm font-bold">{i + 1}</span>
          <span className="flex-1 text-sm font-semibold leading-snug">{text(id)}</span>
          <button
            type="button"
            aria-label={`Move ${text(id)} up`}
            disabled={i === 0}
            onClick={() => onChange(moveItem(order, i, -1))}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 disabled:opacity-30"
          >
            <ArrowUp aria-hidden className="h-5 w-5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            aria-label={`Move ${text(id)} down`}
            disabled={i === order.length - 1}
            onClick={() => onChange(moveItem(order, i, 1))}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 disabled:opacity-30"
          >
            <ArrowDown aria-hidden className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </li>
      ))}
    </ol>
  );
}

function CalcBoard({ problems, typed, onChange }: { problems: { id: string; text: string; unit: string }[]; typed: Record<string, string>; onChange: (typed: Record<string, string>) => void }) {
  return (
    <ol className="flex flex-col gap-3">
      {problems.map((p, i) => (
        <li key={p.id} className="rounded-2xl bg-white/[0.06] p-3">
          <p className="leading-snug">
            <span className="font-bold">{i + 1}. </span>
            {p.text}
          </p>
          <label className="mt-2 flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={typed[p.id] ?? ""}
              onChange={(e) => onChange({ ...typed, [p.id]: e.target.value })}
              aria-label={`Answer to problem ${i + 1}, in ${p.unit}`}
              className="min-h-12 w-32 rounded-xl bg-white/10 px-3 text-lg font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            />
            <span className="text-white/70">{p.unit}</span>
          </label>
        </li>
      ))}
    </ol>
  );
}

function RoundResult({ result, onEnding, onAgain, onClose }: { result: GameResult; onEnding: () => void; onAgain: () => void; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-center" role="status">
        <p className="text-5xl font-black">
          {result.correct}
          <span className="text-2xl text-white/50"> / {result.total}</span>
        </p>
        <p className="mt-1 text-lg font-bold">{result.pct === 100 ? "Perfect round!" : result.pct >= 80 ? "Strong round." : "Good practice. Look over the misses."}</p>
        {result.bestPct !== null && <p className="text-sm text-white/60">Your best: {result.bestPct}%</p>}
      </div>

      <ul className="flex flex-col gap-2">
        {result.items.map((item) => (
          <li key={item.id} className={cn("rounded-2xl p-3", item.correct ? "bg-emerald-400/10" : "bg-rose-500/15")}>
            <p className="flex items-start gap-2 font-semibold leading-snug">
              {item.correct ? (
                <Check aria-label="Right" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" strokeWidth={3} />
              ) : (
                <X aria-label="Missed" className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" strokeWidth={3} />
              )}
              {item.label}
            </p>
            <p className="mt-1 text-sm text-white/85">
              {item.correct ? item.expected : `Answer: ${item.expected}${item.given ? `. You said ${item.given}.` : "."}`}
            </p>
            {item.why && <p className="mt-1 text-sm text-white/70">{item.why}</p>}
            {item.steps && item.steps.length > 0 && (
              <ol className="mt-2 list-decimal pl-5 text-sm text-white/75">
                {item.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>

      {result.ending.length > 0 ? (
        <GlossyButton variant="emerald" size="lg" className="justify-center" onClick={onEnding}>
          Finish with {result.ending.length} NCLEX-style question{result.ending.length === 1 ? "" : "s"}
        </GlossyButton>
      ) : (
        <div className="flex justify-center gap-3">
          <GlossyButton variant="violet" onClick={onAgain}>
            Play again
          </GlossyButton>
          <GlossyButton onClick={onClose}>Done</GlossyButton>
        </div>
      )}
    </div>
  );
}
