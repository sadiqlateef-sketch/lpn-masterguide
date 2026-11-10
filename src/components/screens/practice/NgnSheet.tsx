"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { PracticeView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { EndingQuestions } from "./Ending";
import { Busy, errorText, FullSheet, Problem } from "./FullSheet";
import { SharePanel } from "./SharePanel";

// Next Generation NCLEX practice for one stone: matrix, drop-down, highlight and ordered-response
// questions written from the student's own sources.

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; items: PracticeView[] }
  | { kind: "writing" }
  | { kind: "playing"; items: PracticeView[]; round: number }
  | { kind: "error"; message: string; retry: () => void };

export function NgnSheet({ stone, onClose, onChanged }: { stone: { id: string; title: string } | null; onClose: () => void; onChanged: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const load = useCallback(async (id: string) => {
    setPhase({ kind: "loading" });
    try {
      setPhase({ kind: "ready", items: (await api.stoneNgn(id)).items });
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e, "The questions didn't load. Try again."), retry: () => void load(id) });
    }
  }, []);

  useEffect(() => {
    if (stone) void load(stone.id);
  }, [stone, load]);

  const writeMore = async (id: string) => {
    setPhase({ kind: "writing" });
    try {
      setPhase({ kind: "ready", items: (await api.moreNgn(id)).items });
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e, "The new questions didn't come out. Try again."), retry: () => void writeMore(id) });
    }
  };

  return (
    <FullSheet open={stone !== null} title={`NGN practice: ${stone?.title ?? ""}`} icon={<Sparkles />} tone="text-sky-200" onClose={onClose}>
      <GlassCard glow="cyan" className="p-6">
        {phase.kind === "loading" && <Busy label="Getting your questions..." />}
        {phase.kind === "writing" && <Busy label="Writing new NGN questions from your sources..." />}
        {phase.kind === "error" && <Problem message={phase.message} onRetry={phase.retry} onClose={onClose} />}
        {phase.kind === "ready" && stone && (
          <div className="flex flex-col items-center gap-4 text-center">
            {phase.items.length > 0 ? (
              <>
                <p className="text-lg font-semibold">
                  {phase.items.length} NGN question{phase.items.length === 1 ? "" : "s"} for this stone
                </p>
                <p className="text-sm text-white/70">Matrix, drop-down, highlight and ordered response, each with a reason for every choice.</p>
                <GlossyButton variant="blue" size="lg" onClick={() => setPhase({ kind: "playing", items: phase.items, round: Date.now() })}>
                  Start
                </GlossyButton>
              </>
            ) : (
              <p className="text-lg font-semibold">No NGN questions for this stone yet.</p>
            )}
            <GlossyButton onClick={() => void writeMore(stone.id)}>{phase.items.length ? "Write 4 more" : "Write 4 from my sources"}</GlossyButton>
            <div className="mt-2 w-full border-t border-white/10 pt-4">
              <SharePanel stone={stone} />
            </div>
          </div>
        )}
        {phase.kind === "playing" && stone && (
          <EndingQuestions
            key={phase.round}
            title="Next Generation NCLEX practice"
            items={phase.items}
            onDone={() => {
              onChanged();
              setPhase({ kind: "ready", items: phase.items });
            }}
          />
        )}
      </GlassCard>
    </FullSheet>
  );
}
