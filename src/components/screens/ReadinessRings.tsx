"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Lock, Target } from "lucide-react";
import type { ReadinessCategory, ReadinessView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { GLASS_SURFACE, GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";

type ReadinessRingsProps = {
  // Changes whenever progress may have changed, so the numbers reload.
  refreshKey: number;
  onOpenStone: (stone: { id: string; title: string }) => void;
};

export function ReadinessRings({ refreshKey, onOpenStone }: ReadinessRingsProps) {
  const [data, setData] = useState<ReadinessView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.readiness());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your readiness.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (error && !data) {
    return (
      <GlassCard glow="ruby" role="alert">
        <p className="text-lg font-semibold">{error}</p>
        <GlossyButton variant="ruby" className="mt-4" onClick={load}>
          Try again
        </GlossyButton>
      </GlassCard>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-4" aria-busy="true" aria-label="Loading readiness">
        {[0, 1].map((i) => (
          <div key={i} className="aspect-square animate-pulse rounded-full bg-white/[0.06]" />
        ))}
      </div>
    );
  }

  const nclexPct = Math.round(data.nclexReadiness * 100);
  const weak = data.weakCategoryIds.map((id) => data.categories.find((c) => c.id === id)).filter((c): c is ReadinessCategory => Boolean(c));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4">
        <Ring
          label="NCLEX-PN Readiness"
          fraction={data.nclexReadiness}
          gradient={["#22d3ee", "#3b82f6"]}
          glow="rgba(56,189,248,0.55)"
          value={`${nclexPct}%`}
          caption={data.totalAttempts === 0 ? "Not started" : `${data.totalAttempts} answers`}
        />
        {data.hesi ? (
          <Ring
            label="HESI Projection"
            fraction={Math.min(1, data.hesi.projected / 1000)}
            gradient={["#a78bfa", "#34d399"]}
            glow="rgba(167,139,250,0.55)"
            value={String(data.hesi.projected)}
            caption={data.hesi.band.label}
          />
        ) : (
          <Ring
            label="HESI Projection"
            fraction={1 - data.questionsToUnlockHesi / (data.questionsToUnlockHesi + data.totalAttempts || 1)}
            gradient={["#a78bfa", "#6366f1"]}
            glow="rgba(167,139,250,0.35)"
            value={<Lock aria-hidden className="h-9 w-9 text-violet-200" strokeWidth={2.5} />}
            caption={`${data.questionsToUnlockHesi} more to unlock`}
            srValue={`Locked. Answer ${data.questionsToUnlockHesi} more questions to see it.`}
          />
        )}
      </div>

      {data.hesi && <p className="text-center text-sm text-white/65">{data.hesi.band.meaning}</p>}

      <section aria-labelledby="weak-heading" className="flex flex-col gap-3">
        <h2 id="weak-heading" className="flex items-center gap-2 text-lg font-bold">
          <Target aria-hidden className="h-5 w-5 text-amber-300" strokeWidth={2.5} />
          Practice these next
        </h2>
        {weak.length === 0 ? (
          <GlassCard className="p-5">
            <p className="text-white/75">
              {data.totalAttempts === 0
                ? "Finish a lesson's Quick Play and your readiness starts filling in."
                : "No weak spots right now. Keep going down your path!"}
            </p>
          </GlassCard>
        ) : (
          weak.map((category) => <WeakCategory key={category.id} category={category} onOpenStone={onOpenStone} />)
        )}
      </section>

      <p className="text-center text-xs leading-relaxed text-white/45">
        {data.path.mastered} of {data.path.stones} stepping stones mastered. These numbers are the app&apos;s estimate from your practice, not an official
        NCLEX or HESI score.
      </p>
    </div>
  );
}

function WeakCategory({ category, onOpenStone }: { category: ReadinessCategory; onOpenStone: ReadinessRingsProps["onOpenStone"] }) {
  const reduceMotion = useReducedMotion();
  const stone = category.reviewStones[0];
  const pct = category.accuracy === null ? null : Math.round(category.accuracy * 100);
  const content = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="font-bold leading-snug">{category.name}</span>
        <span className="h-2 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
          <span className={cn("block h-full rounded-full", pct === null ? "bg-white/20" : pct < 60 ? "bg-rose-400" : "bg-amber-300")} style={{ width: `${pct ?? 4}%` }} />
        </span>
        <span className="text-sm text-white/60">
          {pct === null ? "Not practiced yet" : `${pct}% right`}
          {stone ? ` · Review "${stone.title}"` : ""}
        </span>
      </span>
      {stone && <ChevronRight aria-hidden className="h-6 w-6 shrink-0 text-white/50" strokeWidth={2.5} />}
    </>
  );
  const classes = cn("flex min-h-16 w-full items-center gap-3 rounded-3xl p-4 text-left", GLASS_SURFACE, "shadow-[inset_0_1px_1px_rgba(255,255,255,0.35)]");

  if (!stone) return <div className={classes}>{content}</div>;
  return (
    <motion.button
      type="button"
      className={cn(classes, "focus-visible:outline-2 focus-visible:outline-sky-300")}
      whileTap={reduceMotion ? undefined : { scale: 0.98 }}
      onClick={() => onOpenStone(stone)}
      aria-label={`${category.name}: ${pct === null ? "not practiced yet" : `${pct}% right`}. Review ${stone.title}`}
    >
      {content}
    </motion.button>
  );
}

type RingProps = {
  label: string;
  fraction: number;
  gradient: [string, string];
  glow: string;
  value: React.ReactNode;
  caption: string;
  srValue?: string;
};

const SIZE = 160;
const STROKE = 16;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Ring({ label, fraction, gradient, glow, value, caption, srValue }: RingProps) {
  const reduceMotion = useReducedMotion();
  const id = `ring${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <figure className="flex flex-col items-center gap-3" aria-label={`${label}: ${srValue ?? (typeof value === "string" ? value : "")}, ${caption}`}>
      <div className={cn("relative aspect-square w-full max-w-[180px] rounded-full p-2", GLASS_SURFACE)} style={{ boxShadow: `0 0 50px -10px ${glow}, inset 0 1px 1px rgba(255,255,255,0.35)` }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full -rotate-90" aria-hidden>
          <defs>
            <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={gradient[0]} />
              <stop offset="100%" stopColor={gradient[1]} />
            </linearGradient>
          </defs>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={STROKE} />
          <motion.circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={`url(#${id}-g)`}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            initial={{ strokeDashoffset: reduceMotion ? CIRCUMFERENCE * (1 - clamped) : CIRCUMFERENCE }}
            animate={{ strokeDashoffset: CIRCUMFERENCE * (1 - clamped) }}
            transition={{ duration: reduceMotion ? 0 : 1.4, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-black tracking-tight text-white">{value}</span>
          <span className="mt-1 text-xs font-semibold text-white/65">{caption}</span>
        </div>
      </div>
      <figcaption className="text-center text-sm font-bold leading-tight text-white/85">{label}</figcaption>
    </figure>
  );
}
