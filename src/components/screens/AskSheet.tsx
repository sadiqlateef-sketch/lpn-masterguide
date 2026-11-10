"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BookOpenText, Loader2, NotebookPen, Send, ShieldAlert, X } from "lucide-react";
import type { AskAnswer } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { GLASS_SURFACE } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";

// "Ask about this card": a follow-up question answered from the stone's own sources, with the
// sources named under the answer. Answers stay in the sheet while the lesson is open.

type Props = {
  target: { stoneId: string; cardId: string; cardTitle: string } | null;
  onClose: () => void;
};

type Turn = { question: string; answer: AskAnswer };

const MAX_QUESTION = 500;

export function AskSheet({ target, onClose }: Props) {
  const reduceMotion = useReducedMotion();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Record<string, Turn[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const key = target ? `${target.stoneId}:${target.cardId}` : "";
  const history = turns[key] ?? [];

  useEffect(() => {
    if (!target) return;
    setQuestion("");
    setError(null);
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  const ask = async () => {
    const value = question.trim();
    if (!target || !value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await api.ask({ stoneId: target.stoneId, cardId: target.cardId, question: value });
      setTurns((t) => ({ ...t, [key]: [...(t[key] ?? []), { question: value, answer }] }));
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {target && (
        <>
          <motion.div
            key="ask-backdrop"
            className="fixed inset-0 z-[70] bg-canvas/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={busy ? undefined : onClose}
            aria-hidden
          />
          <motion.div
            key="ask-sheet"
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Ask about: ${target.cardTitle}`}
            tabIndex={-1}
            initial={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className={cn(
              "fixed inset-x-0 bottom-0 z-[71] mx-auto flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-[2rem] px-5 pt-3 text-white outline-none",
              "pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-20px_60px_-10px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.35)]",
              GLASS_SURFACE,
              "bg-slate-900/80",
            )}
          >
            <div aria-hidden className="mx-auto h-1.5 w-12 rounded-full bg-white/25" />
            <div className="mt-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-sky-300">Ask about this card</p>
                <h2 className="mt-1 truncate text-lg font-bold">{target.cardTitle}</h2>
              </div>
              <GlossyButton size="icon" aria-label="Close" onClick={onClose} icon={<X className="h-6 w-6" strokeWidth={2.5} />} />
            </div>

            <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain" aria-live="polite">
              {history.length === 0 && !busy && (
                <p className="text-sm leading-snug text-white/65">
                  Ask anything about this card. Answers come from your textbook pages and notes first, and name them.
                </p>
              )}
              {history.map((turn) => (
                <div key={turn.answer.id} className="flex flex-col gap-2">
                  <p className="self-end rounded-2xl rounded-br-md bg-sky-400/20 px-4 py-2.5 text-base">{turn.question}</p>
                  <div className="rounded-2xl rounded-bl-md bg-white/[0.07] px-4 py-3">
                    {!turn.answer.inScope && (
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-300">
                        <ShieldAlert aria-hidden className="h-4 w-4" strokeWidth={2.5} />
                        Outside LPN scope
                      </p>
                    )}
                    <p className="whitespace-pre-line text-base leading-relaxed text-white/90">{turn.answer.answer}</p>
                    {turn.answer.sources.length > 0 ? (
                      <ul className="mt-3 flex flex-col gap-1" aria-label="Sources">
                        {turn.answer.sources.map((s) => (
                          <li key={s.label} className="flex items-center gap-1.5 text-xs font-semibold text-white/60">
                            {s.kind === "textbook" ? (
                              <BookOpenText aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                            ) : (
                              <NotebookPen aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                            )}
                            {s.label}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-xs font-semibold text-white/50">From general nursing knowledge, not your sources.</p>
                    )}
                  </div>
                </div>
              ))}
              {busy && (
                <p className="flex items-center gap-2 text-sm text-white/70" role="status">
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                  Checking your sources...
                </p>
              )}
            </div>

            {error && (
              <p role="alert" className="mt-3 text-sm font-semibold text-rose-200">
                {error}
              </p>
            )}
            <form
              className="mt-3 flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void ask();
              }}
            >
              <label htmlFor="ask-question" className="sr-only">
                Your question
              </label>
              <textarea
                id="ask-question"
                value={question}
                onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask();
                  }
                }}
                rows={2}
                autoFocus
                placeholder="Why is the apical pulse checked first?"
                className="min-h-12 flex-1 resize-none rounded-2xl border border-white/15 bg-white/[0.06] p-3 text-base text-white placeholder:text-white/40 focus:border-sky-300/60 focus:outline-none"
              />
              <button
                type="submit"
                aria-label="Ask"
                disabled={!question.trim() || busy}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-sky-400/90 to-blue-600/90 text-snow disabled:opacity-40"
              >
                <Send aria-hidden className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
