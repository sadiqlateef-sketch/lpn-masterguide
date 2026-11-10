"use client";

import { useCallback, useEffect, useState } from "react";
import { NotebookPen, RotateCcw } from "lucide-react";
import type { MistakeView, PracticeView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { itemLabel } from "../QuickPlay";
import { EndingQuestions } from "./Ending";
import { Busy, errorText, FullSheet, Problem } from "./FullSheet";

// Every question whose latest answer was wrong, from lessons, reviews, games and exams, with a note
// the student can keep on each. "Redo" plays them again; a right answer takes one off the list.

const MAX_REDO = 15;

export function stemOf(item: PracticeView): string {
  return item.type === "bowtie" ? item.scenario : item.stem;
}

type Phase = { kind: "loading" } | { kind: "list"; mistakes: MistakeView[] } | { kind: "redo"; items: PracticeView[] } | { kind: "error"; message: string };

export function MistakesSheet({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const load = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      setPhase({ kind: "list", mistakes: (await api.mistakes()).mistakes });
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e, "Your mistakes didn't load. Try again.") });
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <FullSheet open={open} title="Mistake notebook" icon={<NotebookPen />} tone="text-rose-200" onClose={onClose}>
      {phase.kind === "loading" && (
        <GlassCard>
          <Busy label="Opening your notebook..." />
        </GlassCard>
      )}
      {phase.kind === "error" && (
        <GlassCard glow="ruby">
          <Problem message={phase.message} onRetry={() => void load()} onClose={onClose} />
        </GlassCard>
      )}
      {phase.kind === "redo" && (
        <GlassCard glow="emerald" className="p-6">
          <EndingQuestions
            title="Redo your misses"
            items={phase.items}
            onDone={() => {
              onChanged();
              void load();
            }}
          />
        </GlassCard>
      )}
      {phase.kind === "list" &&
        (phase.mistakes.length === 0 ? (
          <GlassCard glow="emerald" className="text-center">
            <p className="text-lg font-semibold">Nothing to fix right now.</p>
            <p className="mt-1 text-white/70">Questions you miss in lessons, reviews, games and exams land here until you get them right.</p>
          </GlassCard>
        ) : (
          <>
            <GlossyButton
              variant="ruby"
              size="lg"
              className="justify-center"
              icon={<RotateCcw className="h-5 w-5" strokeWidth={2.5} />}
              onClick={() => setPhase({ kind: "redo", items: phase.mistakes.slice(0, MAX_REDO).map((m) => m.item) })}
            >
              Redo {Math.min(MAX_REDO, phase.mistakes.length)} of {phase.mistakes.length}
            </GlossyButton>
            <ul className="flex flex-col gap-3">
              {phase.mistakes.map((m) => (
                <MistakeRow key={m.item.id} mistake={m} />
              ))}
            </ul>
          </>
        ))}
    </FullSheet>
  );
}

function MistakeRow({ mistake }: { mistake: MistakeView }) {
  const [note, setNote] = useState(mistake.note);
  const [saved, setSaved] = useState(mistake.note);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  const save = async () => {
    if (note === saved) return;
    setStatus("saving");
    try {
      const result = await api.saveMistakeNote(mistake.item.id, note);
      setSaved(result.note);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  return (
    <li>
      <GlassCard className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-rose-200/80">
          {[mistake.topic, mistake.stoneTitle].filter(Boolean).join(" · ") || itemLabel(mistake.item)}
          {mistake.misses > 1 ? ` · missed ${mistake.misses} times` : ""}
        </p>
        <p className="mt-1 line-clamp-4 leading-snug">{stemOf(mistake.item)}</p>
        <label className="mt-3 block text-xs font-semibold text-white/60">
          Your note
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 1000))}
            onBlur={() => void save()}
            rows={2}
            placeholder="What tripped you up, in your words"
            className="mt-1 block w-full resize-y rounded-xl bg-white/[0.08] p-3 text-sm text-white outline-none placeholder:text-white/35 focus-visible:ring-2 focus-visible:ring-rose-300"
          />
        </label>
        {status !== "idle" && (
          <p role={status === "error" ? "alert" : "status"} className={status === "error" ? "mt-1 text-xs text-rose-200" : "mt-1 text-xs text-white/50"}>
            {status === "error" ? "Your note didn't save. Tap outside the box to try again." : "Saving..."}
          </p>
        )}
      </GlassCard>
    </li>
  );
}
