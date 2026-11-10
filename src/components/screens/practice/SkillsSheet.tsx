"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BadgeCheck, Check, ChevronLeft, ClipboardList } from "lucide-react";
import type { PracticeView, SkillConfidence, SkillRunResult, SkillSummary, SkillView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { EndingQuestions } from "./Ending";
import { Busy, errorText, FullSheet, Problem } from "./FullSheet";

// Skills checklists (F17): go through a skill step by step (out loud, on a manikin, or in your
// head), tick what you did, say how sure you felt, and finish with two NCLEX-style questions.
// The day an instructor signs the skill off can be noted too.

const CONFIDENCE: { id: SkillConfidence; label: string }[] = [
  { id: "not_yet", label: "Not yet" },
  { id: "with_help", label: "With help" },
  { id: "on_my_own", label: "On my own" },
];

const CONFIDENCE_LABEL = Object.fromEntries(CONFIDENCE.map((c) => [c.id, c.label])) as Record<SkillConfidence, string>;

type Phase =
  | { kind: "list"; skills: SkillSummary[] | null }
  | { kind: "loading" }
  | { kind: "skill"; skill: SkillView; done: Set<number>; confidence: SkillConfidence | null; saving: boolean; error: string | null }
  | { kind: "result"; skill: SkillView; run: SkillRunResult }
  | { kind: "ending"; skill: SkillView; questions: PracticeView[] }
  | { kind: "error"; message: string; retry: () => void };

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function SkillsSheet({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "list", skills: null });

  const loadList = useCallback(async () => {
    setPhase({ kind: "list", skills: null });
    try {
      setPhase({ kind: "list", skills: (await api.skills()).skills });
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e, "The skills didn't load. Try again."), retry: () => void loadList() });
    }
  }, []);

  useEffect(() => {
    if (open) void loadList();
  }, [open, loadList]);

  const openSkill = async (id: string) => {
    setPhase({ kind: "loading" });
    try {
      setPhase({ kind: "skill", skill: await api.skill(id), done: new Set(), confidence: null, saving: false, error: null });
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e, "That skill didn't load. Try again."), retry: () => void openSkill(id) });
    }
  };

  const save = async () => {
    if (phase.kind !== "skill" || !phase.confidence || phase.saving) return;
    const { skill, done, confidence } = phase;
    setPhase({ ...phase, saving: true, error: null });
    try {
      const run = await api.runSkill(skill.id, [...done].sort((a, b) => a - b), confidence);
      onChanged();
      setPhase({ kind: "result", skill: { ...skill, questions: run.questions }, run });
    } catch (e) {
      setPhase({ ...phase, saving: false, error: errorText(e, "That run didn't save. Try again.") });
    }
  };

  const title = phase.kind === "skill" || phase.kind === "result" || phase.kind === "ending" ? phase.skill.title : "Skills checklists";

  return (
    <FullSheet open={open} title={title} icon={<ClipboardList />} tone="text-teal-200" onClose={onClose}>
      {phase.kind !== "list" && phase.kind !== "loading" && phase.kind !== "error" && (
        <button type="button" onClick={() => void loadList()} className="flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-white/70">
          <ChevronLeft aria-hidden className="h-4 w-4" strokeWidth={2.5} />
          All skills
        </button>
      )}
      {phase.kind === "loading" && <Busy label="Opening the checklist..." />}
      {phase.kind === "error" && (
        <GlassCard glow="ruby">
          <Problem message={phase.message} onRetry={phase.retry} onClose={onClose} />
        </GlassCard>
      )}

      {phase.kind === "list" &&
        (phase.skills === null ? (
          <Busy label="Getting your skills..." />
        ) : (
          <ul className="flex flex-col gap-2">
            {phase.skills.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => void openSkill(s.id)}
                  className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-white/[0.07] px-4 py-3 text-left ring-1 ring-white/10 focus-visible:outline-2 focus-visible:outline-teal-300"
                >
                  {s.signedOffOn ? (
                    <BadgeCheck aria-hidden className="h-6 w-6 shrink-0 text-emerald-300" strokeWidth={2.2} />
                  ) : (
                    <ClipboardList aria-hidden className="h-6 w-6 shrink-0 text-teal-200" strokeWidth={2.2} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold leading-tight">{s.title}</span>
                    <span className="block text-xs text-white/65">
                      {s.signedOffOn
                        ? `Signed off ${new Date(`${s.signedOffOn}T12:00:00`).toLocaleDateString()}`
                        : s.lastCheck
                          ? `Last run: ${s.lastCheck.stepsDone} of ${s.lastCheck.stepsTotal}, ${CONFIDENCE_LABEL[s.lastCheck.confidence].toLowerCase()}`
                          : s.blurb}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}

      {phase.kind === "skill" && (
        <>
          <p className="text-sm text-white/70">{phase.skill.blurb} Tick each step as you do it. Steps marked critical fail a check-off when missed.</p>
          <ol className="flex flex-col gap-2" aria-label="Steps">
            {phase.skill.steps.map((step) => {
              const ticked = phase.done.has(step.n);
              return (
                <li key={step.n}>
                  <label
                    className={cn(
                      "flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-teal-300",
                      ticked && "bg-teal-400/10 ring-teal-300/40",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={ticked}
                      onChange={() =>
                        setPhase((p) => {
                          if (p.kind !== "skill") return p;
                          const done = new Set(p.done);
                          if (done.has(step.n)) done.delete(step.n);
                          else done.add(step.n);
                          return { ...p, done };
                        })
                      }
                    />
                    <span
                      aria-hidden
                      className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ring-2", ticked ? "bg-teal-300 text-canvas ring-teal-300" : "ring-white/40")}
                    >
                      {ticked && <Check className="h-4 w-4" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 text-sm leading-snug">
                      <span className="font-semibold">
                        {step.n}. {step.text}
                      </span>
                      {step.critical && <span className="ml-2 rounded-full bg-amber-300/20 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-100">Critical</span>}
                      <span className="mt-1 block text-white/60">{step.why}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ol>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-bold">How did it feel?</legend>
            <div className="flex flex-wrap gap-2">
              {CONFIDENCE.map((c) => (
                <label
                  key={c.id}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center rounded-full px-4 text-sm font-semibold ring-1 ring-white/20 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-teal-300",
                    phase.confidence === c.id && "bg-teal-300 text-canvas ring-teal-300",
                  )}
                >
                  <input type="radio" name="confidence" className="sr-only" checked={phase.confidence === c.id} onChange={() => setPhase((p) => (p.kind === "skill" ? { ...p, confidence: c.id } : p))} />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
          {phase.error && (
            <p role="alert" className="text-sm font-semibold text-rose-200">
              {phase.error}
            </p>
          )}
          <GlossyButton variant="emerald" size="lg" className="justify-center" onClick={() => void save()} disabled={!phase.confidence || phase.saving}>
            {phase.saving ? "Saving..." : `Save run (${phase.done.size} of ${phase.skill.steps.length})`}
          </GlossyButton>
          <SignOff skill={phase.skill} onSaved={(signedOffOn) => setPhase((p) => (p.kind === "skill" ? { ...p, skill: { ...p.skill, signedOffOn } } : p))} />
        </>
      )}

      {phase.kind === "result" && (
        <GlassCard glow={phase.run.missedCritical.length ? "amber" : "emerald"} className="p-6">
          <div className="flex flex-col gap-4" role="status">
            <p className="text-center text-4xl font-black">
              {phase.run.check.stepsDone}
              <span className="text-xl text-white/50"> / {phase.run.check.stepsTotal}</span>
            </p>
            {phase.run.missedCritical.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="flex items-center gap-2 font-bold text-amber-100">
                  <AlertTriangle aria-hidden className="h-5 w-5" strokeWidth={2.5} />
                  Critical steps to practice
                </p>
                <ul className="flex flex-col gap-2 text-sm">
                  {phase.run.missedCritical.slice(0, 3).map((s) => (
                    <li key={s.n} className="rounded-2xl bg-white/[0.06] p-3">
                      <span className="font-semibold">{s.text}</span>
                      <span className="mt-1 block text-white/65">{s.why}</span>
                    </li>
                  ))}
                </ul>
                {phase.run.missedCritical.length > 3 && <p className="text-sm text-white/65">And {phase.run.missedCritical.length - 3} more on the checklist.</p>}
              </div>
            ) : (
              <p className="text-center text-white/85">Every critical step done.</p>
            )}
            <GlossyButton variant="emerald" className="self-center" onClick={() => setPhase({ kind: "ending", skill: phase.skill, questions: phase.run.questions })}>
              Two questions to finish
            </GlossyButton>
          </div>
        </GlassCard>
      )}

      {phase.kind === "ending" && (
        <GlassCard glow="emerald" className="p-6">
          {phase.questions.length ? (
            <EndingQuestions
              title={`${phase.skill.title}: NCLEX-style`}
              items={phase.questions}
              onDone={() => {
                onChanged();
                void loadList();
              }}
            />
          ) : (
            <Problem message="This skill's questions didn't load." onClose={() => void loadList()} />
          )}
        </GlassCard>
      )}
    </FullSheet>
  );
}

function SignOff({ skill, onSaved }: { skill: SkillView; onSaved: (signedOffOn: string | null) => void }) {
  const [date, setDate] = useState(skill.signedOffOn ?? today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      onSaved((await api.signOffSkill(skill.id, value)).signedOffOn);
    } catch (e) {
      setError(errorText(e, "That didn't save. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`signoff-${skill.id}`} className="flex flex-col gap-2 rounded-2xl bg-white/[0.05] p-4">
      <h3 id={`signoff-${skill.id}`} className="flex items-center gap-2 text-sm font-bold">
        <BadgeCheck aria-hidden className="h-4 w-4 text-emerald-300" strokeWidth={2.5} />
        {skill.signedOffOn ? `Signed off ${new Date(`${skill.signedOffOn}T12:00:00`).toLocaleDateString()}` : "Instructor sign-off"}
      </h3>
      {skill.signedOffOn ? (
        <GlossyButton className="self-start" onClick={() => void save(null)} disabled={busy}>
          {busy ? "Saving..." : "Clear sign-off"}
        </GlossyButton>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`signoff-date-${skill.id}`}>
            Date signed off
          </label>
          <input
            id={`signoff-date-${skill.id}`}
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-11 rounded-xl bg-black/20 px-3 text-sm text-white"
          />
          <GlossyButton onClick={() => void save(date)} disabled={busy || !date}>
            {busy ? "Saving..." : "Mark signed off"}
          </GlossyButton>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-rose-200">
          {error}
        </p>
      )}
    </section>
  );
}
