"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Gauge, Info, Lock, Map as MapIcon, Plus, Target, TrendingUp, X } from "lucide-react";
import type { ReadinessCategory, ReadinessView, TrendWeek } from "@/lib/api-types";
import { HESI_MIN_ATTEMPTS, PRACTICE_TARGET } from "@/lib/readiness-rules";
import { trendChange, trendLine, trendPoints } from "@/lib/ui/trend";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { GLASS_SURFACE, GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";

type ReadinessRingsProps = {
  // Changes whenever progress may have changed, so the numbers reload.
  refreshKey: number;
  // False before the first book is added, so the empty state points to Magic + instead of the path.
  hasPath: boolean;
  onOpenStone: (stone: { id: string; title: string }) => void;
  onGoToPath: () => void;
  onAddBook: () => void;
};

type Explained = "nclex" | "hesi" | null;

export function ReadinessRings({ refreshKey, hasPath, onOpenStone, onGoToPath, onAddBook }: ReadinessRingsProps) {
  const [data, setData] = useState<ReadinessView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explained, setExplained] = useState<Explained>(null);

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
      <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading readiness">
        <div className="grid grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col items-center gap-3">
              <div className="shimmer aspect-square w-full max-w-[180px] rounded-full" />
              <div className="shimmer h-4 w-28 rounded-full" />
            </div>
          ))}
        </div>
        <div className="shimmer h-28 rounded-3xl" />
        <div className="shimmer h-24 rounded-3xl" />
      </div>
    );
  }

  if (data.totalAttempts === 0) return <FirstRun hasPath={hasPath} onGoToPath={onGoToPath} onAddBook={onAddBook} />;

  const nclexPct = Math.round(data.nclexReadiness * 100);
  const weak = data.weakCategoryIds.map((id) => data.categories.find((c) => c.id === id)).filter((c): c is ReadinessCategory => Boolean(c));
  const toggle = (which: Exclude<Explained, null>) => setExplained((current) => (current === which ? null : which));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 items-start gap-4">
        <Ring
          label="NCLEX-PN Readiness"
          fraction={data.nclexReadiness}
          gradient={["#22d3ee", "#3b82f6"]}
          glow="rgba(56,189,248,0.55)"
          value={`${nclexPct}%`}
          caption={`${data.totalAttempts} answers`}
          note="Weighted like the real test plan."
          expanded={explained === "nclex"}
          onToggle={() => toggle("nclex")}
          explainId="explain-nclex"
        />
        {data.hesi ? (
          <Ring
            label="HESI Projection"
            fraction={Math.min(1, data.hesi.projected / 1000)}
            gradient={["#a78bfa", "#34d399"]}
            glow="rgba(167,139,250,0.55)"
            value={String(data.hesi.projected)}
            caption={data.hesi.band.label}
            note={data.hesi.band.meaning}
            expanded={explained === "hesi"}
            onToggle={() => toggle("hesi")}
            explainId="explain-hesi"
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
            note="Unlocks after 20 answers."
            expanded={explained === "hesi"}
            onToggle={() => toggle("hesi")}
            explainId="explain-hesi"
          />
        )}
      </div>

      <AnimatePresence initial={false}>
        {explained && <Explanation key={explained} which={explained} data={data} onClose={() => setExplained(null)} />}
      </AnimatePresence>

      <TrendCard trend={data.trend} />

      <section aria-labelledby="weak-heading" className="flex flex-col gap-3">
        <h2 id="weak-heading" className="flex items-center gap-2 text-lg font-bold">
          <Target aria-hidden className="h-5 w-5 text-amber-300" strokeWidth={2.5} />
          Practice these next
        </h2>
        {weak.length === 0 ? (
          <GlassCard className="p-5">
            <p className="text-white/75">No weak spots right now. Keep going down your path!</p>
          </GlassCard>
        ) : (
          weak.map((category) => <WeakCategory key={category.id} category={category} onOpenStone={onOpenStone} />)
        )}
      </section>

      <p className="text-center text-xs leading-relaxed text-white/55">
        {data.path.mastered} of {data.path.stones} stepping stones mastered. These numbers are the app&apos;s estimate from your practice, not an official
        NCLEX or HESI score.
      </p>
    </div>
  );
}

// Before the first answer: what fills this screen in, and one button to get there.
function FirstRun({ hasPath, onGoToPath, onAddBook }: Pick<ReadinessRingsProps, "hasPath" | "onGoToPath" | "onAddBook">) {
  const steps = hasPath
    ? ["Open a stone on your path.", "Swipe through its story cards.", "Answer the Quick Play questions."]
    : ["Tap Magic + and add a school book.", "Open your first stone.", "Answer the Quick Play questions."];
  return (
    <GlassCard glow="violet" className="p-7 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-violet-400/20 text-violet-300">
        <Gauge aria-hidden className="h-8 w-8" strokeWidth={2.5} />
      </div>
      <h2 className="mt-4 text-2xl font-bold">Your readiness starts here</h2>
      <p className="mt-2 text-white/75">Every question you answer fills in your NCLEX-PN readiness and, after 20 answers, your HESI projection.</p>
      <ol className="mx-auto mt-5 flex max-w-xs flex-col gap-3 text-left">
        {steps.map((step, i) => (
          <li key={step} className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-400/25 text-sm font-bold text-violet-100">{i + 1}</span>
            <span className="font-semibold leading-snug text-white/90">{step}</span>
          </li>
        ))}
      </ol>
      {hasPath ? (
        <GlossyButton variant="blue" size="lg" className="mt-6" onClick={onGoToPath} icon={<MapIcon className="h-5 w-5" strokeWidth={2.5} />}>
          Go to my path
        </GlossyButton>
      ) : (
        <GlossyButton variant="violet" size="lg" className="mt-6" onClick={onAddBook} icon={<Plus className="h-5 w-5" strokeWidth={3} />}>
          Add a book with Magic +
        </GlossyButton>
      )}
    </GlassCard>
  );
}

// How each number is worked out, in plain words. Mirrors the math in src/lib/server/progress.ts.
function Explanation({ which, data, onClose }: { which: Exclude<Explained, null>; data: ReadinessView; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      id={which === "nclex" ? "explain-nclex" : "explain-hesi"}
      initial={reduceMotion ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <GlassCard glow={which === "nclex" ? "blue" : "violet"} className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Info aria-hidden className={cn("h-5 w-5", which === "nclex" ? "text-sky-300" : "text-violet-300")} strokeWidth={2.5} />
            {which === "nclex" ? "How readiness is worked out" : "How the HESI projection is worked out"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the explanation"
            className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/60 focus-visible:outline-2 focus-visible:outline-sky-300"
          >
            <X aria-hidden className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>
        {which === "nclex" ? (
          <ul className="mt-3 space-y-2 text-white/85">
            <li>Each NCLEX-PN area counts as much as it does on the real test plan.</li>
            <li>In each area: your share right, times how much you&apos;ve practiced it (full credit at {PRACTICE_TARGET} answers).</li>
            <li>A few answers are pulled toward 50%, so 2 out of 2 doesn&apos;t read as 100%.</li>
          </ul>
        ) : (
          <ul className="mt-3 space-y-2 text-white/85">
            <li>It needs {HESI_MIN_ATTEMPTS} answers first{data.hesi ? "" : ` (${data.questionsToUnlockHesi} to go)`}.</li>
            <li>Your weighted share right maps to a score: about 840 at 60%, 900 at 70% and 960 at 80%.</li>
            <li>HESI doesn&apos;t publish a formula, so this is the app&apos;s estimate, lined up with the score bands most programs use.</li>
          </ul>
        )}
      </GlassCard>
    </motion.div>
  );
}

const CHART_W = 300;
const CHART_H = 96;

// Share of questions right, week by week, over the last 8 weeks.
function TrendCard({ trend }: { trend: TrendWeek[] }) {
  const points = trendPoints(trend, CHART_W, CHART_H);
  const change = trendChange(trend);
  const last = points.at(-1);
  const summary =
    change === null
      ? "Your weekly trend shows up after two weeks of practice."
      : `Your share right went ${change >= 0 ? "up" : "down"} ${Math.abs(change)} points since your first practice week.`;

  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <TrendingUp aria-hidden className="h-5 w-5 text-emerald-300" strokeWidth={2.5} />
          Your trend
        </h2>
        {change !== null && (
          <span className={cn("rounded-full px-3 py-1 text-sm font-bold", change >= 0 ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")}>
            {change >= 0 ? "+" : ""}
            {change} pts
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-white/70">{summary}</p>
      {points.length > 0 && (
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="mt-3 h-24 w-full overflow-visible" role="img" aria-label={summary}>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={CHART_W} y1={f * CHART_H} y2={f * CHART_H} stroke="currentColor" className="text-white/10" strokeDasharray="3 5" />
          ))}
          {points.length > 1 && (
            <path d={trendLine(points)} fill="none" stroke="#34d399" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          )}
          {points.map((p) => (
            <circle key={p.week.weekStart} cx={p.x} cy={p.y} r={p === last ? 5.5 : 3.5} fill="#34d399" />
          ))}
          {last && (
            <text x={last.x} y={last.y - 12} textAnchor="end" className="fill-white text-[13px] font-bold">
              {Math.round((last.week.accuracy ?? 0) * 100)}%
            </text>
          )}
        </svg>
      )}
      <div className="mt-1 flex justify-between text-xs text-white/50" aria-hidden>
        <span>8 weeks ago</span>
        <span>This week</span>
      </div>
    </GlassCard>
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
  // One line under the label that belongs to this number (the HESI band's meaning sits under the HESI ring).
  note: string;
  srValue?: string;
  expanded: boolean;
  onToggle: () => void;
  explainId: string;
};

const SIZE = 160;
const STROKE = 16;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Ring({ label, fraction, gradient, glow, value, caption, note, srValue, expanded, onToggle, explainId }: RingProps) {
  const reduceMotion = useReducedMotion();
  const id = `ring${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={expanded ? explainId : undefined}
      aria-label={`${label}: ${srValue ?? (typeof value === "string" ? value : "")}, ${caption}. ${note} Tap to see how it's worked out.`}
      whileTap={reduceMotion ? undefined : { scale: 0.97 }}
      className="flex flex-col items-center gap-3 rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300"
    >
      <div className={cn("relative aspect-square w-full max-w-[180px] rounded-full p-2", GLASS_SURFACE)} style={{ boxShadow: `0 0 50px -10px ${glow}, inset 0 1px 1px rgba(255,255,255,0.35)` }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full -rotate-90" aria-hidden>
          <defs>
            <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={gradient[0]} />
              <stop offset="100%" stopColor={gradient[1]} />
            </linearGradient>
          </defs>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="currentColor" className="text-white/10" strokeWidth={STROKE} />
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
      <span className="flex flex-col items-center gap-1 text-center">
        <span className="flex items-center gap-1 text-sm font-bold leading-tight text-white/90">
          {label}
          <Info aria-hidden className={cn("h-4 w-4 shrink-0", expanded ? "text-sky-300" : "text-white/50")} strokeWidth={2.5} />
        </span>
        <span className="text-xs leading-snug text-white/65">{note}</span>
      </span>
    </motion.button>
  );
}
