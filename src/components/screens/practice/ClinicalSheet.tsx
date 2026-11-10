"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BookOpenText, ChevronLeft, ClipboardPlus, FileHeart, Plus, ShieldAlert, Stethoscope, Trash2 } from "lucide-react";
import type { CarePlanProblem, CarePlanSummary, CarePlanView, ClinicalInput, ClinicalPrepSummary, ClinicalPrepView, PracticeView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { EndingQuestions } from "./Ending";
import { Busy, errorText, FullSheet, Problem } from "./FullSheet";

// Clinical day (F15, F16): a prep sheet for a clinical assignment from the student's own sources, and
// a care plan in LPN scope that the student writes, with a draft to start from and a check to learn
// from. Nothing that identifies a client is typed in; the server refuses names, rooms and record numbers.

type Phase =
  | { kind: "home"; preps: ClinicalPrepSummary[] | null; plans: CarePlanSummary[] | null }
  | { kind: "newPrep" }
  | { kind: "prep"; prep: ClinicalPrepView }
  | { kind: "newPlan"; prep: { id: string; title: string } | null }
  | { kind: "plan"; plan: CarePlanView; draft: CarePlanProblem[]; dirty: boolean; saving: boolean; error: string | null }
  | { kind: "ending"; title: string; questions: PracticeView[]; back: () => void }
  | { kind: "busy"; label: string }
  | { kind: "error"; message: string; retry: () => void };

const PRIVACY = "Don't type names, room numbers, birth dates or record numbers. Diagnoses, medicines and skills are all it needs.";

const lines = (text: string) =>
  text
    .split(/\n|;|,(?![^(]*\))/)
    .map((x) => x.trim())
    .filter(Boolean);

const field = "w-full rounded-xl bg-black/20 px-3 py-2.5 text-sm text-white placeholder:text-white/40";

export function ClinicalSheet({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "home", preps: null, plans: null });

  const home = useCallback(async () => {
    setPhase({ kind: "home", preps: null, plans: null });
    try {
      const [p, c] = await Promise.all([api.clinicalPreps(), api.carePlans()]);
      setPhase({ kind: "home", preps: p.preps, plans: c.plans });
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e, "Clinical day didn't load. Try again."), retry: () => void home() });
    }
  }, []);

  useEffect(() => {
    if (open) void home();
  }, [open, home]);

  const attempt = async <T,>(label: string, work: () => Promise<T>, then: (value: T) => void, fallback: string, back: () => void) => {
    setPhase({ kind: "busy", label });
    try {
      then(await work());
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e, fallback), retry: back });
    }
  };

  const openPrep = (id: string) => attempt("Opening your prep sheet...", () => api.clinicalPrep(id), (prep) => setPhase({ kind: "prep", prep }), "That prep sheet didn't load.", () => void openPrep(id));
  const openPlan = (id: string) =>
    attempt("Opening your care plan...", () => api.carePlan(id), (plan) => setPhase({ kind: "plan", plan, draft: plan.problems, dirty: false, saving: false, error: null }), "That care plan didn't load.", () => void openPlan(id));

  const title =
    phase.kind === "prep" ? phase.prep.title : phase.kind === "plan" || phase.kind === "newPlan" ? "Care plan" : phase.kind === "newPrep" ? "New prep sheet" : "Clinical day";

  return (
    <FullSheet open={open} title={title} icon={<Stethoscope />} tone="text-rose-200" onClose={onClose}>
      {phase.kind !== "home" && phase.kind !== "busy" && (
        <button type="button" onClick={() => void home()} className="flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-white/70">
          <ChevronLeft aria-hidden className="h-4 w-4" strokeWidth={2.5} />
          Clinical day
        </button>
      )}
      {phase.kind === "busy" && <Busy label={phase.label} />}
      {phase.kind === "error" && (
        <GlassCard glow="ruby">
          <Problem message={phase.message} onRetry={phase.retry} onClose={() => void home()} />
        </GlassCard>
      )}

      {phase.kind === "home" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setPhase({ kind: "newPrep" })} className="flex min-h-28 flex-col gap-2 rounded-3xl bg-white/[0.07] p-4 text-left ring-1 ring-white/10 focus-visible:outline-2 focus-visible:outline-rose-300">
              <ClipboardPlus aria-hidden className="h-7 w-7 text-rose-200" strokeWidth={2.2} />
              <span className="font-bold">Prep for clinical</span>
              <span className="text-xs text-white/65">Diagnoses and meds in, a study sheet out.</span>
            </button>
            <button type="button" onClick={() => setPhase({ kind: "newPlan", prep: null })} className="flex min-h-28 flex-col gap-2 rounded-3xl bg-white/[0.07] p-4 text-left ring-1 ring-white/10 focus-visible:outline-2 focus-visible:outline-rose-300">
              <FileHeart aria-hidden className="h-7 w-7 text-rose-200" strokeWidth={2.2} />
              <span className="font-bold">Care plan</span>
              <span className="text-xs text-white/65">Write it in LPN scope, then get it checked.</span>
            </button>
          </div>
          {phase.preps === null ? (
            <Busy label="Getting your clinical days..." />
          ) : (
            <>
              <SavedList heading="Prep sheets" empty="No prep sheets yet." items={phase.preps.map((p) => ({ id: p.id, title: p.title, sub: p.clinicalOn ? new Date(`${p.clinicalOn}T12:00:00`).toLocaleDateString() : new Date(p.createdAt).toLocaleDateString() }))} onOpen={(id) => void openPrep(id)} />
              <SavedList heading="Care plans" empty="No care plans yet." items={(phase.plans ?? []).map((p) => ({ id: p.id, title: p.situation, sub: `${p.problemCount} problem${p.problemCount === 1 ? "" : "s"}` }))} onOpen={(id) => void openPlan(id)} />
            </>
          )}
        </>
      )}

      {phase.kind === "newPrep" && (
        <PrepForm
          onSubmit={(input) =>
            void attempt(
              "Writing your prep sheet from your sources...",
              () => api.createClinicalPrep(input),
              (prep) => {
                onChanged();
                setPhase({ kind: "prep", prep });
              },
              "The prep sheet didn't come out. Try again.",
              () => setPhase({ kind: "newPrep" }),
            )
          }
        />
      )}

      {phase.kind === "prep" && (
        <PrepView
          prep={phase.prep}
          onQuestions={() => setPhase({ kind: "ending", title: `${phase.prep.title}: NCLEX-style`, questions: phase.prep.questions, back: () => void openPrep(phase.prep.id) })}
          onCarePlan={() => setPhase({ kind: "newPlan", prep: { id: phase.prep.id, title: phase.prep.title } })}
          onDelete={() => void attempt("Deleting...", () => api.deleteClinicalPrep(phase.prep.id), () => void home(), "That didn't delete. Try again.", () => void home())}
        />
      )}

      {phase.kind === "newPlan" && (
        <PlanStart
          prep={phase.prep}
          onSubmit={(situation) =>
            void attempt(
              "Drafting a plan to start from...",
              () => api.createCarePlan(situation, phase.prep?.id ?? null),
              (plan) => setPhase({ kind: "plan", plan, draft: plan.problems, dirty: false, saving: false, error: null }),
              "The draft didn't come out. Try again.",
              () => setPhase({ kind: "newPlan", prep: phase.prep }),
            )
          }
        />
      )}

      {phase.kind === "plan" && (
        <PlanEditor
          phase={phase}
          setDraft={(draft) => setPhase((p) => (p.kind === "plan" ? { ...p, draft, dirty: true } : p))}
          onSave={async () => {
            setPhase({ ...phase, saving: true, error: null });
            try {
              const plan = await api.saveCarePlan(phase.plan.id, phase.draft);
              setPhase({ kind: "plan", plan, draft: plan.problems, dirty: false, saving: false, error: null });
            } catch (e) {
              setPhase({ ...phase, saving: false, error: errorText(e, "That didn't save. Try again.") });
            }
          }}
          onCheck={async () => {
            setPhase({ kind: "busy", label: "Checking your plan..." });
            try {
              if (phase.dirty) await api.saveCarePlan(phase.plan.id, phase.draft);
              const plan = await api.checkCarePlan(phase.plan.id);
              onChanged();
              setPhase({ kind: "plan", plan, draft: plan.problems, dirty: false, saving: false, error: null });
            } catch (e) {
              setPhase({ ...phase, saving: false, error: errorText(e, "The check didn't come out. Try again.") });
            }
          }}
          onQuestions={(questions) => setPhase({ kind: "ending", title: "Care plan: NCLEX-style", questions, back: () => void openPlan(phase.plan.id) })}
          onDelete={() => void attempt("Deleting...", () => api.deleteCarePlan(phase.plan.id), () => void home(), "That didn't delete. Try again.", () => void home())}
        />
      )}

      {phase.kind === "ending" && (
        <GlassCard glow="emerald" className="p-6">
          {phase.questions.length ? (
            <EndingQuestions
              title={phase.title}
              items={phase.questions}
              onDone={() => {
                onChanged();
                phase.back();
              }}
            />
          ) : (
            <Problem message="No questions came with this one." onClose={phase.back} />
          )}
        </GlassCard>
      )}
    </FullSheet>
  );
}

function SavedList({ heading, empty, items, onOpen }: { heading: string; empty: string; items: { id: string; title: string; sub: string }[]; onOpen: (id: string) => void }) {
  return (
    <section className="flex flex-col gap-2" aria-label={heading}>
      <h3 className="text-lg font-bold">{heading}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-white/60">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => onOpen(i.id)} className="flex min-h-14 w-full flex-col justify-center rounded-2xl bg-white/[0.06] px-4 py-2 text-left focus-visible:outline-2 focus-visible:outline-rose-300">
                <span className="line-clamp-1 font-semibold">{i.title}</span>
                <span className="text-xs text-white/60">{i.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Labeled({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      {hint && <p className="text-xs text-white/55">{hint}</p>}
      {children}
    </div>
  );
}

function PrepForm({ onSubmit }: { onSubmit: (input: ClinicalInput) => void }) {
  const [title, setTitle] = useState("");
  const [clinicalOn, setClinicalOn] = useState("");
  const [diagnoses, setDiagnoses] = useState("");
  const [medications, setMedications] = useState("");
  const [skills, setSkills] = useState("");
  const [focus, setFocus] = useState("");
  const ready = title.trim() && (diagnoses.trim() || medications.trim() || skills.trim());

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onSubmit({
          title: title.trim(),
          clinicalOn: clinicalOn || null,
          diagnoses: lines(diagnoses).slice(0, 6),
          medications: lines(medications).slice(0, 12),
          skills: lines(skills).slice(0, 6),
          focus: focus.trim(),
        });
      }}
    >
      <p className="flex items-start gap-2 rounded-2xl bg-amber-300/10 p-3 text-sm font-semibold text-amber-100">
        <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
        {PRIVACY}
      </p>
      <Labeled id="prep-title" label="Name this day">
        <input id="prep-title" className={cn(field, "min-h-11")} value={title} maxLength={120} placeholder="Thursday med-surg" onChange={(e) => setTitle(e.target.value)} />
      </Labeled>
      <Labeled id="prep-date" label="Date (optional)">
        <input id="prep-date" type="date" className={cn(field, "min-h-11")} value={clinicalOn} onChange={(e) => setClinicalOn(e.target.value)} />
      </Labeled>
      <Labeled id="prep-dx" label="Diagnoses" hint="One per line, up to 6.">
        <textarea id="prep-dx" rows={3} className={field} value={diagnoses} placeholder={"Heart failure\nType 2 diabetes"} onChange={(e) => setDiagnoses(e.target.value)} />
      </Labeled>
      <Labeled id="prep-meds" label="Medications" hint="One per line, up to 12.">
        <textarea id="prep-meds" rows={3} className={field} value={medications} placeholder={"Furosemide\nMetformin"} onChange={(e) => setMedications(e.target.value)} />
      </Labeled>
      <Labeled id="prep-skills" label="Skills you might do" hint="One per line, up to 6.">
        <textarea id="prep-skills" rows={2} className={field} value={skills} placeholder="Fingerstick glucose" onChange={(e) => setSkills(e.target.value)} />
      </Labeled>
      <Labeled id="prep-focus" label="Anything to focus on (optional)">
        <input id="prep-focus" className={cn(field, "min-h-11")} value={focus} maxLength={300} placeholder="Fall risk" onChange={(e) => setFocus(e.target.value)} />
      </Labeled>
      <GlossyButton type="submit" variant="emerald" size="lg" className="justify-center" disabled={!ready}>
        Make my prep sheet
      </GlossyButton>
    </form>
  );
}

function Bullets({ label, items, tone }: { label: string; items: string[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <div>
      <p className={cn("text-xs font-bold uppercase tracking-wide", tone ?? "text-white/60")}>{label}</p>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-white/85">
        {items.slice(0, 3).map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function FromSources() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-sky-400/15 px-2 py-0.5 align-middle text-[11px] font-bold text-sky-100">
      <BookOpenText aria-hidden className="h-3 w-3" strokeWidth={2.5} />
      From your sources
    </span>
  );
}

function PrepView({ prep, onQuestions, onCarePlan, onDelete }: { prep: ClinicalPrepView; onQuestions: () => void; onCarePlan: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const s = prep.sheet;
  return (
    <>
      {s.conditions.map((c, i) => (
        <GlassCard key={`c${i}`} glow="blue">
          <h3 className="text-lg font-bold leading-snug">
            {c.name}
            {c.fromSources && <FromSources />}
          </h3>
          <p className="mt-1 text-sm text-white/80">{c.summary}</p>
          <div className="mt-3 flex flex-col gap-3">
            <Bullets label="Watch for" items={c.watch} />
            <Bullets label="You do" items={c.actions} tone="text-emerald-200" />
            <Bullets label="Report to the RN" items={c.report} tone="text-amber-200" />
          </div>
        </GlassCard>
      ))}
      {s.medications.map((m, i) => (
        <GlassCard key={`m${i}`} glow="emerald">
          <h3 className="text-lg font-bold leading-snug">
            {m.name}
            {m.fromSources && <FromSources />}
          </h3>
          <p className="text-xs font-semibold text-white/60">{m.drugClass}</p>
          <p className="mt-1 text-sm text-white/80">{m.why}</p>
          <div className="mt-3 flex flex-col gap-3">
            <Bullets label="Check first" items={m.checkFirst} tone="text-amber-200" />
            <Bullets label="Watch for" items={m.watch} />
          </div>
        </GlassCard>
      ))}
      {s.skills.map((k, i) => (
        <GlassCard key={`k${i}`} glow="cyan">
          <h3 className="text-lg font-bold leading-snug">{k.name}</h3>
          <div className="mt-2">
            <Bullets label="Key points" items={k.points} />
          </div>
        </GlassCard>
      ))}
      {prep.sources.length > 0 && (
        <details className="rounded-2xl bg-white/[0.05] p-4 text-sm">
          <summary className="min-h-11 cursor-pointer font-semibold">Where this came from ({prep.sources.length})</summary>
          <ul className="mt-2 flex flex-col gap-2 text-white/75">
            {prep.sources.map((r, i) => (
              <li key={i}>
                <span className="font-semibold">{r.label}:</span> &ldquo;{r.quote}&rdquo;
              </li>
            ))}
          </ul>
        </details>
      )}
      <GlossyButton variant="emerald" size="lg" className="justify-center" onClick={onQuestions} disabled={!prep.questions.length}>
        {prep.questions.length} questions to finish
      </GlossyButton>
      <GlossyButton className="justify-center" onClick={onCarePlan} icon={<FileHeart className="h-4 w-4" strokeWidth={2.5} />}>
        Start a care plan from this
      </GlossyButton>
      <DeleteButton what="prep sheet" confirm={confirm} setConfirm={setConfirm} onDelete={onDelete} />
    </>
  );
}

function DeleteButton({ what, confirm, setConfirm, onDelete }: { what: string; confirm: boolean; setConfirm: (v: boolean) => void; onDelete: () => void }) {
  return confirm ? (
    <div className="flex items-center justify-center gap-2" role="group" aria-label={`Delete this ${what}?`}>
      <GlossyButton variant="ruby" onClick={onDelete}>
        Yes, delete it
      </GlossyButton>
      <GlossyButton onClick={() => setConfirm(false)}>Keep it</GlossyButton>
    </div>
  ) : (
    <button type="button" onClick={() => setConfirm(true)} className="flex min-h-11 items-center justify-center gap-1 text-sm font-semibold text-white/55">
      <Trash2 aria-hidden className="h-4 w-4" strokeWidth={2.5} />
      Delete this {what}
    </button>
  );
}

function PlanStart({ prep, onSubmit }: { prep: { id: string; title: string } | null; onSubmit: (situation: string) => void }) {
  const [situation, setSituation] = useState("");
  const ready = situation.trim().length >= 10;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit(situation.trim());
      }}
    >
      <p className="flex items-start gap-2 rounded-2xl bg-amber-300/10 p-3 text-sm font-semibold text-amber-100">
        <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
        {PRIVACY}
      </p>
      {prep && <p className="text-sm text-white/70">Using the diagnoses and medicines from {prep.title}.</p>}
      <Labeled id="plan-situation" label="The client's situation" hint="What you know from report and your data collection, in a few sentences.">
        <textarea
          id="plan-situation"
          rows={5}
          maxLength={2000}
          className={field}
          value={situation}
          placeholder="Older adult with heart failure, short of breath walking to the bathroom, 2+ ankle swelling, on furosemide."
          onChange={(e) => setSituation(e.target.value)}
        />
      </Labeled>
      <p className="text-xs text-white/55">You&apos;ll get a draft to start from. Change anything; the plan is yours.</p>
      <GlossyButton type="submit" variant="emerald" size="lg" className="justify-center" disabled={!ready}>
        Draft a plan to start from
      </GlossyButton>
    </form>
  );
}

const EMPTY_PROBLEM: CarePlanProblem = { problem: "", relatedTo: "", evidence: [], goal: "", interventions: [{ action: "", why: "" }], reportToRn: [], evaluation: "" };

type PlanPhase = Extract<Phase, { kind: "plan" }>;

function PlanEditor({
  phase,
  setDraft,
  onSave,
  onCheck,
  onQuestions,
  onDelete,
}: {
  phase: PlanPhase;
  setDraft: (draft: CarePlanProblem[]) => void;
  onSave: () => void;
  onCheck: () => void;
  onQuestions: (questions: PracticeView[]) => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const { plan, draft } = phase;
  const update = (i: number, change: Partial<CarePlanProblem>) => setDraft(draft.map((p, j) => (j === i ? { ...p, ...change } : p)));
  const clean = draft.every((p) => p.problem.trim() && p.interventions.some((x) => x.action.trim()));

  return (
    <>
      <p className="rounded-2xl bg-white/[0.05] p-3 text-sm text-white/80">{plan.situation}</p>
      {draft.map((p, i) => (
        <GlassCard key={i} glow="violet" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold">Problem {i + 1}</h3>
            {draft.length > 1 && (
              <button type="button" onClick={() => setDraft(draft.filter((_, j) => j !== i))} className="flex min-h-11 min-w-11 items-center justify-center text-white/55" aria-label={`Remove problem ${i + 1}`}>
                <Trash2 aria-hidden className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
          <Labeled id={`p${i}-problem`} label="Problem">
            <input id={`p${i}-problem`} className={cn(field, "min-h-11")} value={p.problem} maxLength={200} onChange={(e) => update(i, { problem: e.target.value })} />
          </Labeled>
          <Labeled id={`p${i}-related`} label="Related to">
            <input id={`p${i}-related`} className={cn(field, "min-h-11")} value={p.relatedTo} maxLength={300} onChange={(e) => update(i, { relatedTo: e.target.value })} />
          </Labeled>
          <Labeled id={`p${i}-evidence`} label="Shown by" hint="One finding per line.">
            <textarea id={`p${i}-evidence`} rows={3} className={field} value={p.evidence.join("\n")} onChange={(e) => update(i, { evidence: e.target.value.split("\n").slice(0, 5) })} />
          </Labeled>
          <Labeled id={`p${i}-goal`} label="Goal" hint="Measurable, with a time frame.">
            <textarea id={`p${i}-goal`} rows={2} className={field} value={p.goal} maxLength={400} onChange={(e) => update(i, { goal: e.target.value })} />
          </Labeled>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-bold">What you&apos;ll do, and why</legend>
            {p.interventions.map((x, k) => (
              <div key={k} className="flex flex-col gap-1 rounded-xl bg-white/[0.04] p-2">
                <label className="sr-only" htmlFor={`p${i}-a${k}`}>
                  Action {k + 1}
                </label>
                <input
                  id={`p${i}-a${k}`}
                  className={cn(field, "min-h-11")}
                  value={x.action}
                  maxLength={280}
                  placeholder="Action"
                  onChange={(e) => update(i, { interventions: p.interventions.map((y, m) => (m === k ? { ...y, action: e.target.value } : y)) })}
                />
                <label className="sr-only" htmlFor={`p${i}-w${k}`}>
                  Why, for action {k + 1}
                </label>
                <input
                  id={`p${i}-w${k}`}
                  className={cn(field, "min-h-11")}
                  value={x.why}
                  maxLength={280}
                  placeholder="Why"
                  onChange={(e) => update(i, { interventions: p.interventions.map((y, m) => (m === k ? { ...y, why: e.target.value } : y)) })}
                />
                {p.interventions.length > 1 && (
                  <button type="button" onClick={() => update(i, { interventions: p.interventions.filter((_, m) => m !== k) })} className="min-h-11 self-end text-xs font-semibold text-white/55">
                    Remove this action
                  </button>
                )}
              </div>
            ))}
            {p.interventions.length < 8 && (
              <button type="button" onClick={() => update(i, { interventions: [...p.interventions, { action: "", why: "" }] })} className="flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-violet-200">
                <Plus aria-hidden className="h-4 w-4" strokeWidth={2.5} />
                Add an action
              </button>
            )}
          </fieldset>
          <Labeled id={`p${i}-report`} label="Report to the RN" hint="One per line.">
            <textarea id={`p${i}-report`} rows={2} className={field} value={p.reportToRn.join("\n")} onChange={(e) => update(i, { reportToRn: e.target.value.split("\n").slice(0, 5) })} />
          </Labeled>
          <Labeled id={`p${i}-eval`} label="How you'll know it worked">
            <textarea id={`p${i}-eval`} rows={2} className={field} value={p.evaluation} maxLength={400} onChange={(e) => update(i, { evaluation: e.target.value })} />
          </Labeled>
        </GlassCard>
      ))}
      {draft.length < 5 && (
        <button type="button" onClick={() => setDraft([...draft, EMPTY_PROBLEM])} className="flex min-h-11 items-center justify-center gap-1 text-sm font-semibold text-violet-200">
          <Plus aria-hidden className="h-4 w-4" strokeWidth={2.5} />
          Add a problem
        </button>
      )}
      {phase.error && (
        <p role="alert" className="text-sm font-semibold text-rose-200">
          {phase.error}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        <GlossyButton onClick={onSave} disabled={!phase.dirty || phase.saving || !clean}>
          {phase.saving ? "Saving..." : phase.dirty ? "Save changes" : "Saved"}
        </GlossyButton>
        <GlossyButton variant="violet" onClick={onCheck} disabled={phase.saving || !clean}>
          Check my plan
        </GlossyButton>
      </div>

      {plan.feedback && !phase.dirty && (
        <GlassCard glow={plan.feedback.scopeFlags.length ? "amber" : "emerald"} className="flex flex-col gap-3" role="status">
          <h3 className="text-lg font-bold">Your check</h3>
          <p className="text-sm text-white/85">{plan.feedback.verdict}</p>
          <Bullets label="Done well" items={plan.feedback.strengths} tone="text-emerald-200" />
          {plan.feedback.fixes.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-sky-200">To fix</p>
              <ul className="mt-1 flex flex-col gap-2 text-sm">
                {plan.feedback.fixes.slice(0, 3).map((f, i) => (
                  <li key={i} className="rounded-xl bg-white/[0.05] p-3">
                    <span className="font-semibold">{f.where}: </span>
                    {f.issue}
                    <span className="mt-1 block text-white/70">Try: {f.better}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.feedback.scopeFlags.length > 0 && (
            <div>
              <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-amber-200">
                <AlertTriangle aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />
                Outside LPN scope
              </p>
              <ul className="mt-1 flex flex-col gap-2 text-sm">
                {plan.feedback.scopeFlags.slice(0, 3).map((f, i) => (
                  <li key={i} className="rounded-xl bg-amber-300/10 p-3">
                    &ldquo;{f.text}&rdquo;
                    <span className="mt-1 block text-white/70">{f.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.questions.length > 0 && (
            <GlossyButton variant="emerald" className="self-center" onClick={() => onQuestions(plan.questions.slice(-2))}>
              Two questions to finish
            </GlossyButton>
          )}
        </GlassCard>
      )}
      <DeleteButton what="care plan" confirm={confirm} setConfirm={setConfirm} onDelete={onDelete} />
    </>
  );
}
