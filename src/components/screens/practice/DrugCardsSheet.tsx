"use client";

import { useCallback, useEffect, useState } from "react";
import { BookMarked, ChevronLeft, Pill, Trash2 } from "lucide-react";
import type { DrugCardField, DrugCardView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { EndingQuestions } from "./Ending";
import { Busy, errorText, FullSheet, Problem } from "./FullSheet";

// Drug cards: type a medication, get a card built from the student's own passages and notes where
// they cover it (marked "From your sources"), drug-guide knowledge elsewhere, and two NCLEX-style
// questions to finish.

type Listed = { id: string; name: string; drugClass: string };

type Phase =
  | { kind: "loading" }
  | { kind: "list"; cards: Listed[]; error: string | null; making: boolean }
  | { kind: "card"; card: DrugCardView; quiz: boolean; confirmDelete: boolean }
  | { kind: "error"; message: string };

export function DrugCardsSheet({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      setPhase({ kind: "list", cards: (await api.drugCards()).cards, error: null, making: false });
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e, "Your drug cards didn't load. Try again.") });
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const make = async () => {
    if (phase.kind !== "list" || !name.trim() || phase.making) return;
    setPhase({ ...phase, making: true, error: null });
    try {
      const card = await api.createDrugCard(name.trim());
      setName("");
      setPhase({ kind: "card", card, quiz: false, confirmDelete: false });
    } catch (e) {
      setPhase({ ...phase, making: false, error: errorText(e, "The card didn't come out. Try again.") });
    }
  };

  const openCard = async (id: string) => {
    setPhase({ kind: "loading" });
    try {
      setPhase({ kind: "card", card: await api.drugCard(id), quiz: false, confirmDelete: false });
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e, "That card didn't load. Try again.") });
    }
  };

  const remove = async (id: string) => {
    setPhase({ kind: "loading" });
    try {
      await api.deleteDrugCard(id);
    } finally {
      void load();
    }
  };

  return (
    <FullSheet open={open} title="Drug cards" icon={<Pill />} tone="text-emerald-200" onClose={onClose}>
      {phase.kind === "loading" && (
        <GlassCard>
          <Busy label="Opening your drug cards..." />
        </GlassCard>
      )}
      {phase.kind === "error" && (
        <GlassCard glow="ruby">
          <Problem message={phase.message} onRetry={() => void load()} onClose={onClose} />
        </GlassCard>
      )}
      {phase.kind === "list" && (
        <>
          <GlassCard glow="emerald">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void make();
              }}
              className="flex flex-col gap-3"
            >
              <label htmlFor="drug-name" className="font-semibold">
                Make a card for a medication
              </label>
              <input
                id="drug-name"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 80))}
                placeholder="For example, metoprolol"
                autoComplete="off"
                autoCapitalize="none"
                className="min-h-12 rounded-xl bg-white/10 px-4 text-white outline-none placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-emerald-300"
              />
              {phase.error && (
                <p role="alert" className="text-sm font-semibold text-rose-200">
                  {phase.error}
                </p>
              )}
              <GlossyButton type="submit" variant="emerald" className="justify-center" disabled={!name.trim() || phase.making}>
                {phase.making ? "Writing your card..." : "Make the card"}
              </GlossyButton>
            </form>
          </GlassCard>
          {phase.cards.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {phase.cards.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void openCard(c.id)}
                    className="flex min-h-14 w-full flex-col justify-center rounded-2xl bg-white/[0.06] px-4 py-2 text-left focus-visible:outline-2 focus-visible:outline-emerald-300"
                  >
                    <span className="font-semibold">{c.name}</span>
                    {c.drugClass && <span className="line-clamp-1 text-sm text-white/60">{c.drugClass}</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-center text-sm text-white/60">Your cards will be listed here.</p>
          )}
        </>
      )}
      {phase.kind === "card" && (
        <GlassCard glow="emerald" className="p-6">
          {phase.quiz ? (
            <EndingQuestions
              title={`Check yourself: ${phase.card.name}`}
              items={phase.card.questions}
              onDone={() => {
                onChanged();
                setPhase({ ...phase, quiz: false });
              }}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <button type="button" onClick={() => void load()} className="flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-emerald-200">
                <ChevronLeft aria-hidden className="h-4 w-4" strokeWidth={2.5} />
                All cards
              </button>
              <h2 className="text-2xl font-bold">{phase.card.name}</h2>
              <dl className="flex flex-col gap-3">
                <Field label="Class" field={phase.card.drugClass} />
                <Field label="How it works" field={phase.card.action} />
                <Field label="Used for" field={phase.card.uses} />
                <Field label="Side effects to watch" field={phase.card.sideEffects} />
                <Field label="What the LPN does" field={phase.card.nursing} />
                <Field label="Client teaching" field={phase.card.teaching} />
                {phase.card.holdParameters && <Field label="Hold and report when" field={phase.card.holdParameters} />}
              </dl>
              {phase.card.sources.length > 0 && (
                <details className="rounded-2xl bg-white/[0.05] p-3 text-sm">
                  <summary className="cursor-pointer font-semibold text-emerald-200">Where this came from ({phase.card.sources.length})</summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {phase.card.sources.map((s) => (
                      <li key={`${s.label}:${s.quote}`}>
                        <p className="text-xs font-semibold text-white/60">{s.label}</p>
                        <p className="italic text-white/80">&ldquo;{s.quote}&rdquo;</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <p className="text-xs text-white/55">Fields without the &ldquo;From your sources&rdquo; mark come from general drug-guide knowledge. Check them against your drug guide.</p>
              {phase.card.questions.length > 0 && (
                <GlossyButton variant="emerald" size="lg" className="justify-center" onClick={() => setPhase({ ...phase, quiz: true })}>
                  Finish with {phase.card.questions.length} NCLEX-style questions
                </GlossyButton>
              )}
              {phase.confirmDelete ? (
                <div className="flex items-center justify-center gap-3">
                  <GlossyButton variant="ruby" onClick={() => void remove(phase.card.id)}>
                    Delete this card
                  </GlossyButton>
                  <GlossyButton onClick={() => setPhase({ ...phase, confirmDelete: false })}>Keep it</GlossyButton>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPhase({ ...phase, confirmDelete: true })}
                  className="flex min-h-11 items-center gap-1 self-center text-sm font-semibold text-white/55"
                >
                  <Trash2 aria-hidden className="h-4 w-4" strokeWidth={2.5} />
                  Delete card
                </button>
              )}
            </div>
          )}
        </GlassCard>
      )}
    </FullSheet>
  );
}

function Field({ label, field }: { label: string; field: DrugCardField }) {
  if (!field.text) return null;
  return (
    <div>
      <dt className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide text-white/60">
        {label}
        {field.fromSources && (
          <span className={cn("flex items-center gap-1 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[0.65rem] normal-case tracking-normal text-emerald-100")}>
            <BookMarked aria-hidden className="h-3 w-3" strokeWidth={2.5} />
            From your sources
          </span>
        )}
      </dt>
      <dd className="mt-0.5 leading-snug">{field.text}</dd>
    </div>
  );
}
