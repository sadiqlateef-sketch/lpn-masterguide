"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardCheck, Timer } from "lucide-react";
import type { ExamState, ExamSummary } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { attemptBody, EMPTY_ANSWERS, isAnswerReady, type AnswerState } from "@/lib/quick-play";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { itemLabel, PracticeItemBody } from "../QuickPlay";
import { Busy, errorText, FullSheet, Problem } from "./FullSheet";

// A timed practice exam that adapts to the student: no feedback until it ends, like the real test.
// It stops once the estimate is clearly above or below the passing line, or at the item or time limit.

export type ExamOpen = { start: "short" | "long" } | { resume: string };

type Phase =
  | { kind: "loading" }
  | { kind: "question"; state: ExamState; answers: AnswerState; sending: boolean; error: string | null }
  | { kind: "done"; summary: ExamSummary }
  | { kind: "error"; message: string; retry: () => void };

export function ExamSheet({ open, onClose, onChanged }: { open: ExamOpen | null; onClose: () => void; onChanged: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const show = useCallback(
    (state: ExamState) => {
      if (state.current && !state.summary.stopReason) setPhase({ kind: "question", state, answers: EMPTY_ANSWERS, sending: false, error: null });
      else {
        setPhase({ kind: "done", summary: state.summary });
        onChanged();
      }
    },
    [onChanged],
  );

  const load = useCallback(
    async (how: ExamOpen) => {
      setPhase({ kind: "loading" });
      try {
        show("start" in how ? await api.startExam(how.start) : await api.exam(how.resume));
      } catch (e) {
        setPhase({ kind: "error", message: errorText(e, "The exam didn't load. Try again."), retry: () => void load(how) });
      }
    },
    [show],
  );

  useEffect(() => {
    if (open) void load(open);
  }, [open, load]);

  const answer = async () => {
    if (phase.kind !== "question" || !phase.state.current || phase.sending) return;
    const { state, answers } = phase;
    setPhase({ ...phase, sending: true, error: null });
    try {
      const result = await api.answerExam(state.summary.id, attemptBody(state.current!.item, answers));
      show(result.state);
    } catch (e) {
      setPhase({ ...phase, sending: false, error: errorText(e, "Your answer didn't save. Try again.") });
    }
  };

  const end = async () => {
    if (phase.kind !== "question") return;
    const id = phase.state.summary.id;
    setPhase({ kind: "loading" });
    try {
      show(await api.endExam(id));
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e, "The exam didn't end. Try again."), retry: () => void load({ resume: id }) });
    }
  };

  // When the clock runs out, reopening the exam closes it on the server.
  const timeUp = useCallback(() => {
    if (phase.kind === "question") void load({ resume: phase.state.summary.id });
  }, [phase, load]);

  return (
    <FullSheet open={open !== null} title="Practice exam" icon={<ClipboardCheck />} tone="text-sky-200" onClose={onClose}>
      <GlassCard glow="blue" className="p-6">
        {phase.kind === "loading" && <Busy label="Getting your exam..." />}
        {phase.kind === "error" && <Problem message={phase.message} onRetry={phase.retry} onClose={onClose} />}
        {phase.kind === "question" && phase.state.current && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-wide text-sky-200/80">
              <span>
                Question {phase.state.summary.answered + 1} · up to {phase.state.summary.maxItems}
              </span>
              <ExamClock summary={phase.state.summary} onTimeUp={timeUp} />
            </div>
            <p className="text-xs font-semibold text-white/55">{itemLabel(phase.state.current.item)}</p>
            <PracticeItemBody
              key={phase.state.current.item.id}
              item={phase.state.current.item}
              result={undefined}
              answers={phase.answers}
              setAnswers={(fn) => setPhase((p) => (p.kind === "question" ? { ...p, answers: fn(p.answers) } : p))}
            />
            {phase.error && (
              <p role="alert" className="text-sm font-semibold text-rose-200">
                {phase.error}
              </p>
            )}
            <GlossyButton
              variant="blue"
              size="lg"
              className="justify-center"
              onClick={() => void answer()}
              disabled={!isAnswerReady(phase.state.current.item, phase.answers) || phase.sending}
            >
              {phase.sending ? "Saving..." : "Submit and go on"}
            </GlossyButton>
            <button type="button" onClick={() => void end()} className="min-h-11 text-sm font-semibold text-white/60 underline-offset-4 hover:underline">
              End the exam now
            </button>
          </div>
        )}
        {phase.kind === "done" && <ExamResult summary={phase.summary} onClose={onClose} />}
      </GlassCard>
    </FullSheet>
  );
}

function ExamClock({ summary, onTimeUp }: { summary: ExamSummary; onTimeUp: () => void }) {
  const endsAt = new Date(summary.startedAt).getTime() + summary.timeLimitMinutes * 60000;
  const [left, setLeft] = useState(() => Math.max(0, endsAt - Date.now()));
  const fired = useRef(false);
  const timeUp = useRef(onTimeUp);
  timeUp.current = onTimeUp;
  useEffect(() => {
    const tick = () => {
      const remaining = Math.max(0, endsAt - Date.now());
      setLeft(remaining);
      if (remaining === 0 && !fired.current) {
        fired.current = true;
        timeUp.current();
      }
    };
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);
  const minutes = Math.floor(left / 60000);
  const seconds = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  return (
    <span role="timer" aria-label={`${minutes} minutes left`} className={cn("flex items-center gap-1 tabular-nums", left < 5 * 60000 && "text-rose-200")}>
      <Timer aria-hidden className="h-4 w-4" strokeWidth={2.5} />
      {minutes}:{seconds}
    </span>
  );
}

export function ExamResult({ summary, onClose }: { summary: ExamSummary; onClose?: () => void }) {
  const pct = summary.answered ? Math.round((summary.correct / summary.answered) * 100) : 0;
  return (
    <div className="flex flex-col gap-4" role="status">
      <div className="text-center">
        <p className="text-5xl font-black">
          {summary.correct}
          <span className="text-2xl text-white/50"> / {summary.answered}</span>
        </p>
        <p className="mt-1 text-sm text-white/60">{pct}% right</p>
      </div>
      <p className="rounded-2xl bg-white/[0.06] p-4 leading-snug text-white/90">{summary.verdict}</p>
      {summary.byClientNeed.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="By client need">
          {summary.byClientNeed.map((n) => {
            const share = n.answered ? n.correct / n.answered : 0;
            return (
              <li key={n.id}>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="font-semibold">{n.name}</span>
                  <span className="tabular-nums text-white/70">
                    {n.correct} / {n.answered}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
                  <div className={cn("h-full rounded-full", share >= 0.8 ? "bg-emerald-400" : share >= 0.6 ? "bg-amber-300" : "bg-rose-400")} style={{ width: `${Math.round(share * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm text-white/60">Every question you missed is in your mistake notebook, with the reasons.</p>
      {onClose && (
        <GlossyButton variant="blue" className="self-center" onClick={onClose}>
          Done
        </GlossyButton>
      )}
    </div>
  );
}
