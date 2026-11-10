"use client";

import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BookPlus, Check, Lock, Play, RotateCcw, Sparkles } from "lucide-react";
import type { PathCourse, PathStone, PathView, StoneStatus } from "@/lib/api-types";
import { cn } from "@/lib/cn";
import { GLASS_SURFACE, GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";

type PathMapProps = {
  path: PathView | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenStone: (stone: PathStone) => void;
  onAddBook: () => void;
};

const STATUS: Record<StoneStatus, { label: string; node: string; ring: string; Icon: typeof Play; glow: string }> = {
  ready: {
    label: "Ready",
    node: "bg-gradient-to-b from-sky-300 to-blue-600 text-white",
    ring: "ring-sky-300/50",
    Icon: Play,
    glow: "0 0 36px 4px rgba(56,189,248,0.55)",
  },
  mastered: {
    label: "Mastered",
    node: "bg-gradient-to-b from-emerald-300 to-emerald-600 text-white",
    ring: "ring-emerald-300/40",
    Icon: Check,
    glow: "0 0 28px 2px rgba(52,211,153,0.45)",
  },
  needs_review: {
    label: "Needs review",
    node: "bg-gradient-to-b from-rose-400 to-rose-700 text-white",
    ring: "ring-rose-300/50",
    Icon: RotateCcw,
    glow: "0 0 40px 6px rgba(244,63,94,0.6)",
  },
  locked: {
    label: "Locked",
    node: "bg-white/[0.06] text-white/40",
    ring: "ring-white/10",
    Icon: Lock,
    glow: "none",
  },
};

// A gentle zigzag, like a trail across the page.
const OFFSETS = [0, 52, 78, 52, 0, -52, -78, -52];

export function PathMap({ path, loading, error, onRetry, onOpenStone, onAddBook }: PathMapProps) {
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const scrolledTo = useRef<string | null>(null);

  // Bring the next stone into view once, when the path first loads or the next stone changes.
  useEffect(() => {
    const next = path?.nextStoneId;
    if (!next || scrolledTo.current === next) return;
    const node = nodeRefs.current.get(next);
    if (!node) return;
    scrolledTo.current = next;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [path?.nextStoneId]);

  if (loading && !path) return <PathSkeleton />;

  if (error && !path) {
    return (
      <GlassCard glow="ruby" role="alert">
        <p className="text-lg font-semibold">{error}</p>
        <GlossyButton variant="ruby" className="mt-4" onClick={onRetry}>
          Try again
        </GlossyButton>
      </GlassCard>
    );
  }

  if (!path || path.courses.length === 0) {
    return (
      <GlassCard glow="blue" className="p-7 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-sky-400/20 text-sky-300">
          <BookPlus aria-hidden className="h-8 w-8" strokeWidth={2.5} />
        </div>
        <h2 className="mt-4 text-2xl font-bold">Add your first school book</h2>
        <p className="mt-2 text-white/70">Type its name or snap its table of contents. Your path builds itself.</p>
        <GlossyButton variant="blue" size="lg" className="mt-6" onClick={onAddBook} icon={<Sparkles className="h-5 w-5" strokeWidth={2.5} />}>
          Add a book
        </GlossyButton>
      </GlassCard>
    );
  }

  let stoneIndex = 0;
  return (
    <div className="flex flex-col gap-8">
      <Legend counts={path.counts} />
      {path.courses.map((course) => (
        <CourseSection key={course.id} course={course}>
          {course.books.map((book) => (
            <div key={book.id} className="flex flex-col gap-6">
              {course.books.length > 1 && <p className="text-center text-sm font-semibold text-white/50">{book.title}</p>}
              {book.units.map((unit) => (
                <div key={unit.id} className="flex flex-col gap-5">
                  <p className="text-center text-xs font-bold uppercase tracking-widest text-white/45">{unit.title}</p>
                  {unit.modules.map((module) => (
                    <div key={module.id} className="flex flex-col items-center gap-3">
                      <div className={cn("w-full rounded-2xl px-4 py-3 text-center", GLASS_SURFACE)}>
                        <p className="text-base font-bold leading-snug">
                          {module.chapterNumber && <span className="text-sky-300">Ch {module.chapterNumber} · </span>}
                          {module.title}
                        </p>
                      </div>
                      <ol className="flex flex-col items-center gap-2 py-2">
                        {module.stones.map((stone) => {
                          const offset = OFFSETS[stoneIndex++ % OFFSETS.length];
                          return (
                            <li key={stone.id} style={{ transform: `translateX(${offset}px)` }}>
                              <StoneNode
                                stone={stone}
                                isNext={stone.id === path.nextStoneId}
                                onOpen={onOpenStone}
                                ref={(el) => {
                                  if (el) nodeRefs.current.set(stone.id, el);
                                  else nodeRefs.current.delete(stone.id);
                                }}
                              />
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </CourseSection>
      ))}
    </div>
  );
}

function CourseSection({ course, children }: { course: PathCourse; children: React.ReactNode }) {
  const stones = course.books.flatMap((b) => b.units.flatMap((u) => u.modules.flatMap((m) => m.stones)));
  const mastered = stones.filter((s) => s.status === "mastered").length;
  return (
    <section aria-labelledby={`course-${course.id}`} className="flex flex-col gap-6">
      <div className={cn("sticky top-3 z-20 mx-auto flex items-center gap-3 rounded-full px-5 py-2.5", GLASS_SURFACE)}>
        <h2 id={`course-${course.id}`} className="text-lg font-bold">
          {course.name}
        </h2>
        <span className="text-sm font-semibold text-emerald-300">
          {mastered}/{stones.length}
        </span>
      </div>
      {children}
    </section>
  );
}

type StoneNodeProps = {
  stone: PathStone;
  isNext: boolean;
  onOpen: (stone: PathStone) => void;
  ref: (el: HTMLButtonElement | null) => void;
};

function StoneNode({ stone, isNext, onOpen, ref }: StoneNodeProps) {
  const reduceMotion = useReducedMotion();
  const meta = STATUS[stone.status];
  const locked = stone.status === "locked";
  const pulse = !reduceMotion && (stone.status === "needs_review" || isNext);

  return (
    <div className="flex w-32 flex-col items-center gap-2">
      <motion.button
        ref={ref}
        type="button"
        disabled={locked}
        onClick={() => onOpen(stone)}
        aria-label={`${stone.title}, ${meta.label}${isNext ? ", up next" : ""}`}
        whileTap={locked || reduceMotion ? undefined : { scale: 0.9 }}
        animate={pulse ? { boxShadow: [meta.glow, "0 0 0px 0px rgba(0,0,0,0)", meta.glow] } : { boxShadow: meta.glow }}
        transition={pulse ? { duration: 2.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
        className={cn(
          "relative flex h-[72px] w-[72px] items-center justify-center rounded-full ring-4",
          "border border-t-white/50 border-l-white/30 border-b-white/5 border-r-white/5",
          "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300",
          "disabled:cursor-not-allowed",
          meta.node,
          meta.ring,
        )}
      >
        {!locked && <span aria-hidden className="pointer-events-none absolute inset-x-3 top-1.5 h-1/3 rounded-full bg-gradient-to-b from-white/50 to-transparent" />}
        <meta.Icon aria-hidden className="relative h-8 w-8" strokeWidth={3} />
      </motion.button>
      <p className={cn("line-clamp-2 text-center text-sm font-semibold leading-tight", locked ? "text-white/40" : "text-white/90")}>{stone.title}</p>
    </div>
  );
}

function Legend({ counts }: { counts: PathView["counts"] }) {
  const items = [
    { label: "Ready", dot: "bg-sky-400" },
    { label: `Mastered ${counts.mastered}`, dot: "bg-emerald-400" },
    { label: `Review ${counts.needsReview}`, dot: "bg-rose-500" },
  ];
  return (
    <ul className="flex justify-center gap-4 text-xs font-semibold text-white/60" aria-label="Map key">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("h-2.5 w-2.5 rounded-full", item.dot)} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function PathSkeleton() {
  return (
    <div className="flex flex-col items-center gap-6" aria-busy="true" aria-label="Loading your path">
      <div className="h-11 w-48 animate-pulse rounded-full bg-white/[0.06]" />
      {OFFSETS.slice(0, 5).map((offset, i) => (
        <div key={i} className="h-[72px] w-[72px] animate-pulse rounded-full bg-white/[0.06]" style={{ transform: `translateX(${offset}px)` }} />
      ))}
    </div>
  );
}
