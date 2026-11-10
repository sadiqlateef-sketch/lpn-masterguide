"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "framer-motion";
import { ArrowDown, BookPlus, CalendarRange, Check, ChevronDown, Clock, ListOrdered, Lock, Play, RotateCcw, Route, Sparkles } from "lucide-react";
import type { PathCourse, PathModule, PathStone, PathView, StoneStatus } from "@/lib/api-types";
import { readString, writeString } from "@/lib/client/prefs";
import { cn } from "@/lib/cn";
import { connectorPath, courseChapters, courseOfStone, courseStats, findStone, neighborCourse, type Point } from "@/lib/ui/path-view";
import { GLASS_SURFACE, GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { PlanView } from "./PlanView";

type PathMapProps = {
  path: PathView | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenStone: (stone: { id: string; title: string }) => void;
  onAddBook: () => void;
};

const STATUS: Record<StoneStatus, { label: string; node: string; ring: string; Icon: typeof Play; glow: string; trail: string }> = {
  ready: {
    label: "Ready",
    node: "bg-gradient-to-b from-sky-300 to-blue-600 text-snow",
    ring: "ring-sky-300/50",
    Icon: Play,
    glow: "0 0 36px 4px rgba(56,189,248,0.55)",
    trail: "text-sky-300/50",
  },
  mastered: {
    label: "Mastered",
    node: "bg-gradient-to-b from-emerald-300 to-emerald-600 text-snow",
    ring: "ring-emerald-300/40",
    Icon: Check,
    glow: "0 0 28px 2px rgba(52,211,153,0.45)",
    trail: "text-emerald-300/70",
  },
  needs_review: {
    label: "Needs review",
    node: "bg-gradient-to-b from-rose-400 to-rose-700 text-snow",
    ring: "ring-rose-300/50",
    Icon: RotateCcw,
    glow: "0 0 40px 6px rgba(244,63,94,0.6)",
    trail: "text-rose-300/50",
  },
  locked: {
    label: "Locked",
    node: "bg-canvas text-white/45",
    ring: "ring-white/10",
    Icon: Lock,
    glow: "none",
    trail: "text-white/20",
  },
};

// A gentle zigzag, like a trail across the page.
const OFFSETS = [0, 52, 78, 52, 0, -52, -78, -52];
const COURSE_KEY = "lpn:path-course";
const VIEW_KEY = "lpn:path-view";
const SWIPE_DISTANCE = 80;

export function PathMap({ path, loading, error, onRetry, onOpenStone, onAddBook }: PathMapProps) {
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const chapterRefs = useRef(new Map<string, HTMLDivElement>());
  const scrolledTo = useRef<string | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  // "path" shows the stone trail; "plan" shows the course's weekly plan.
  const [view, setView] = useState<"path" | "plan">("path");
  useEffect(() => setView(readString(VIEW_KEY) === "plan" ? "plan" : "path"), []);
  const chooseView = useCallback((next: "path" | "plan") => {
    setView(next);
    writeString(VIEW_KEY, next);
  }, []);
  // Something to scroll to once the chosen course has rendered: a stone or a chapter.
  const [pendingScroll, setPendingScroll] = useState<{ kind: "stone" | "chapter"; id: string } | null>(null);
  const reduceMotion = useReducedMotion();

  // Pick the course to show: the one remembered on this phone if it still exists, else the one with the next stone.
  const courses = path?.courses ?? [];
  const nextStoneId = path?.nextStoneId ?? null;
  const shownCourse = courses.find((c) => c.id === courseId) ?? null;
  useEffect(() => {
    if (!path || path.courses.length === 0) return;
    if (courseId && path.courses.some((c) => c.id === courseId)) return;
    const remembered = readString(COURSE_KEY);
    setCourseId(path.courses.some((c) => c.id === remembered) ? remembered : courseOfStone(path, path.nextStoneId));
  }, [path, courseId]);

  const chooseCourse = useCallback((id: string) => {
    setCourseId(id);
    writeString(COURSE_KEY, id);
    setChaptersOpen(false);
  }, []);

  const scrollToStone = useCallback((id: string) => {
    const node = nodeRefs.current.get(id);
    if (!node) return false;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    node.focus({ preventScroll: true });
    return true;
  }, []);

  // Bring the next stone into view once, when the path first loads or the next stone changes.
  useEffect(() => {
    if (!nextStoneId || scrolledTo.current === nextStoneId || !shownCourse) return;
    const node = nodeRefs.current.get(nextStoneId);
    if (!node) return;
    scrolledTo.current = nextStoneId;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [nextStoneId, shownCourse]);

  useEffect(() => {
    if (!pendingScroll) return;
    if (pendingScroll.kind === "stone") {
      if (scrollToStone(pendingScroll.id)) setPendingScroll(null);
      return;
    }
    const el = chapterRefs.current.get(pendingScroll.id);
    if (el) {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
      setPendingScroll(null);
    }
  }, [pendingScroll, courseId, scrollToStone]);

  const closeChapters = useCallback(() => setChaptersOpen(false), []);

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

  if (!path || path.courses.length === 0) return <EmptyPath onAddBook={onAddBook} />;

  const course = shownCourse ?? path.courses[0];
  const nextStone = findStone(path, path.nextStoneId);

  const continueToNext = () => {
    if (!path.nextStoneId) return;
    const target = courseOfStone(path, path.nextStoneId);
    if (target && target !== course.id) chooseCourse(target);
    setPendingScroll({ kind: "stone", id: path.nextStoneId });
  };

  // Swiping sideways across the path moves to the next or previous course.
  const onPanEnd = (_: unknown, info: PanInfo) => {
    const { x, y } = info.offset;
    if (Math.abs(x) < SWIPE_DISTANCE || Math.abs(x) < Math.abs(y) * 1.5) return;
    const target = neighborCourse(path.courses, course.id, x < 0 ? 1 : -1);
    if (target) chooseCourse(target);
  };

  let stoneIndex = 0;
  return (
    <div className="flex flex-col gap-5">
      <Legend counts={path.counts} />

      <div className="sticky top-[max(0.75rem,var(--safe-top))] z-20">
        {path.courses.length > 1 ? (
          <CourseTabs courses={path.courses} activeId={course.id} onChoose={chooseCourse} />
        ) : (
          <CourseBadge course={course} />
        )}
      </div>

      <ViewToggle view={view} onChange={chooseView} />

      {view === "plan" ? (
        <PlanView key={course.id} courseId={course.id} courseName={course.name} onOpenStone={onOpenStone} />
      ) : (
        <>
          <div className="relative flex flex-wrap items-center justify-center gap-3">
            {nextStone && (
              <GlossyButton variant="blue" onClick={continueToNext} icon={<Play className="h-4 w-4" strokeWidth={3} />} className="max-w-full">
                <span className="block max-w-[14rem] truncate">Continue: {nextStone.title}</span>
              </GlossyButton>
            )}
            <GlossyButton
              onClick={() => setChaptersOpen((open) => !open)}
              aria-expanded={chaptersOpen}
              aria-controls="chapter-list"
              icon={<ListOrdered className="h-4 w-4" strokeWidth={2.5} />}
            >
              <span className="flex items-center gap-1">
                Chapters
                <ChevronDown aria-hidden className={cn("h-4 w-4 transition-transform", chaptersOpen && "rotate-180")} strokeWidth={2.5} />
              </span>
            </GlossyButton>
            <AnimatePresence>
              {chaptersOpen && (
                <ChapterList
                  course={course}
                  nextStoneId={path.nextStoneId}
                  onPick={(moduleId) => {
                    setChaptersOpen(false);
                    setPendingScroll({ kind: "chapter", id: moduleId });
                  }}
                  onClose={closeChapters}
                />
              )}
            </AnimatePresence>
          </div>

          <motion.section
            key={course.id}
            aria-labelledby={`course-${course.id}`}
            className="flex flex-col gap-6"
            style={{ touchAction: "pan-y" }}
            onPanEnd={path.courses.length > 1 ? onPanEnd : undefined}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h2 id={`course-${course.id}`} className="sr-only">
              {course.name}
            </h2>
            {course.books.map((book) => (
              <div key={book.id} className="flex flex-col gap-6">
                {course.books.length > 1 && <p className="text-center text-sm font-semibold text-white/60">{book.title}</p>}
                {book.units.map((unit) => (
                  <div key={unit.id} className="flex flex-col gap-5">
                    <p className="text-center text-xs font-bold uppercase tracking-widest text-white/55">{unit.title}</p>
                    {unit.modules.map((module) => {
                      const offsets = module.stones.map(() => OFFSETS[stoneIndex++ % OFFSETS.length]);
                      return (
                        <ChapterBlock
                          key={module.id}
                          module={module}
                          offsets={offsets}
                          nextStoneId={path.nextStoneId}
                          onOpen={onOpenStone}
                          headerRef={(el) => {
                            if (el) chapterRefs.current.set(module.id, el);
                            else chapterRefs.current.delete(module.id);
                          }}
                          nodeRef={(id, el) => {
                            if (el) nodeRefs.current.set(id, el);
                            else nodeRefs.current.delete(id);
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
            <CourseFooter course={course} />
          </motion.section>
        </>
      )}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: "path" | "plan"; onChange: (view: "path" | "plan") => void }) {
  const options = [
    { id: "path" as const, label: "Path", Icon: Route },
    { id: "plan" as const, label: "Plan", Icon: CalendarRange },
  ];
  return (
    <div role="group" aria-label="Show the path or the weekly plan" className={cn("mx-auto flex rounded-full p-1", GLASS_SURFACE)}>
      {options.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => onChange(id)}
          className={cn("flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-bold", view === id ? "bg-white/15 text-white" : "text-white/60 hover:text-white")}
        >
          <Icon aria-hidden className="h-4 w-4" strokeWidth={2.5} />
          {label}
        </button>
      ))}
    </div>
  );
}

function CourseTabs({ courses, activeId, onChoose }: { courses: PathCourse[]; activeId: string; onChoose: (id: string) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  // Keep the chosen tab in view when the row scrolls sideways.
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>(`[data-course="${activeId}"]`);
    if (!list || !tab) return;
    list.scrollTo({ left: tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
  }, [activeId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const target = neighborCourse(courses, activeId, e.key === "ArrowRight" ? 1 : -1);
    if (!target) return;
    e.preventDefault();
    onChoose(target);
    listRef.current?.querySelector<HTMLElement>(`[data-course="${target}"]`)?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Courses"
      onKeyDown={onKeyDown}
      className={cn("flex snap-x gap-1 overflow-x-auto rounded-full p-1.5 [scrollbar-width:none]", GLASS_SURFACE)}
    >
      {courses.map((course) => {
        const stats = courseStats(course);
        const active = course.id === activeId;
        return (
          <button
            key={course.id}
            type="button"
            role="tab"
            data-course={course.id}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChoose(course.id)}
            className={cn(
              "relative flex min-h-11 flex-1 shrink-0 snap-center items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-sky-300",
              active ? "text-white" : "text-white/60",
            )}
          >
            {active && (
              <motion.span
                layoutId="course-tab"
                className="absolute inset-0 rounded-full bg-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]"
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              />
            )}
            <span className="relative">{course.name}</span>
            <span className={cn("relative text-xs", active ? "text-emerald-300" : "text-white/50")}>
              {stats.mastered}/{stats.total}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CourseBadge({ course }: { course: PathCourse }) {
  const stats = courseStats(course);
  return (
    <div className={cn("mx-auto flex w-fit items-center gap-3 rounded-full px-5 py-2.5", GLASS_SURFACE)}>
      <p className="text-lg font-bold">{course.name}</p>
      <span className="text-sm font-semibold text-emerald-300">
        {stats.mastered}/{stats.total}
      </span>
    </div>
  );
}

type ChapterListProps = {
  course: PathCourse;
  nextStoneId: string | null;
  onPick: (moduleId: string) => void;
  onClose: () => void;
};

function ChapterList({ course, nextStoneId, onPick, onClose }: ChapterListProps) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current?.contains(target) || target.closest('[aria-controls="chapter-list"]')) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      id="chapter-list"
      role="region"
      aria-label={`${course.name} chapters`}
      initial={reduceMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
      className={cn(
        "absolute inset-x-0 top-full z-30 mt-2 max-h-[55dvh] overflow-y-auto rounded-3xl bg-dock p-2 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.6)] backdrop-blur-2xl",
        "border border-t-edge-t border-l-edge-l border-b-edge-soft border-r-edge-soft",
      )}
    >
      <ul className="flex flex-col">
        {courseChapters(course, nextStoneId).map(({ module, mastered, total, hasNext }) => (
          <li key={module.id}>
            <button
              type="button"
              onClick={() => onPick(module.id)}
              className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-sky-300"
            >
              {module.chapterNumber && <span className="w-11 shrink-0 text-sm font-bold text-sky-300">Ch {module.chapterNumber}</span>}
              <span className="min-w-0 flex-1 font-semibold leading-snug">{module.title}</span>
              {hasNext && <span className="shrink-0 rounded-full bg-sky-400/20 px-2 py-0.5 text-xs font-bold text-sky-200">Next</span>}
              <span className={cn("shrink-0 text-sm font-semibold", total > 0 && mastered === total ? "text-emerald-300" : "text-white/55")}>
                {mastered}/{total}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

type ChapterBlockProps = {
  module: PathModule;
  offsets: number[];
  nextStoneId: string | null;
  onOpen: (stone: PathStone) => void;
  headerRef: (el: HTMLDivElement | null) => void;
  nodeRef: (id: string, el: HTMLButtonElement | null) => void;
};

function ChapterBlock({ module, offsets, nextStoneId, onOpen, headerRef, nodeRef }: ChapterBlockProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const locked = module.stones.filter((s) => s.status === "locked").length;

  // Measure the stone centers so the trail runs through them, and again whenever the layout changes
  // (bigger text, rotating or unfolding the phone).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const box = list.getBoundingClientRect();
      const next = [...list.querySelectorAll<HTMLElement>("[data-stone-node]")].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
      });
      setPoints((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [module.stones.length]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div ref={headerRef} className={cn("w-full scroll-mt-28 rounded-2xl px-4 py-3 text-center", GLASS_SURFACE)}>
        <p className="text-base font-bold leading-snug">
          {module.chapterNumber && <span className="text-sky-300">Ch {module.chapterNumber} · </span>}
          {module.title}
        </p>
        {locked > 0 && <p className="mt-0.5 text-xs font-semibold text-white/55">{locked === module.stones.length ? `${locked} stones coming up` : `${locked} more coming up`}</p>}
      </div>
      <ol ref={listRef} className="relative flex flex-col items-center gap-2 py-2">
        <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          {points.slice(1).map((p, i) => (
            <path
              key={module.stones[i].id}
              d={connectorPath([points[i], p])}
              fill="none"
              stroke="currentColor"
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={module.stones[i].status === "mastered" ? undefined : "1 10"}
              className={STATUS[module.stones[i].status].trail}
            />
          ))}
        </svg>
        {module.stones.map((stone, i) => (
          <li key={stone.id} className="relative" style={{ transform: `translateX(${offsets[i]}px)` }}>
            <StoneNode stone={stone} isNext={stone.id === nextStoneId} onOpen={onOpen} ref={(el) => nodeRef(stone.id, el)} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function CourseFooter({ course }: { course: PathCourse }) {
  const stats = courseStats(course);
  if (stats.total === 0) return null;
  return (
    <p className="text-center text-sm font-semibold text-white/60">
      {stats.mastered === stats.total
        ? `All ${stats.total} stones in ${course.name} mastered!`
        : `${stats.mastered} of ${stats.total} mastered${stats.locked > 0 ? `, ${stats.locked} still to unlock` : ""}`}
    </p>
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
    <div className={cn("flex w-32 flex-col items-center gap-2", locked && "opacity-75")}>
      <motion.button
        ref={ref}
        type="button"
        data-stone-node
        disabled={locked}
        onClick={() => onOpen(stone)}
        aria-label={`${stone.title}, ${meta.label}${stone.dueForReview ? ", review due" : ""}${isNext ? ", up next" : ""}`}
        whileTap={locked || reduceMotion ? undefined : { scale: 0.9 }}
        animate={pulse ? { boxShadow: [meta.glow, "0 0 0px 0px rgba(0,0,0,0)", meta.glow] } : { boxShadow: meta.glow }}
        transition={pulse ? { duration: 2.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
        className={cn(
          "relative flex h-[72px] w-[72px] items-center justify-center rounded-full ring-4",
          locked ? "border-2 border-dashed border-white/25" : "border border-t-snow/50 border-l-snow/30 border-b-snow/5 border-r-snow/5",
          "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300",
          "disabled:cursor-not-allowed",
          meta.node,
          meta.ring,
        )}
      >
        {!locked && <span aria-hidden className="pointer-events-none absolute inset-x-3 top-1.5 h-1/3 rounded-full bg-gradient-to-b from-snow/50 to-transparent" />}
        <meta.Icon aria-hidden className={cn("relative", locked ? "h-6 w-6" : "h-8 w-8")} strokeWidth={3} />
        {stone.dueForReview && (
          <span aria-hidden className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-amber-300 text-canvas ring-2 ring-canvas">
            <Clock className="h-4 w-4" strokeWidth={3} />
          </span>
        )}
      </motion.button>
      <p className={cn("line-clamp-2 rounded-lg bg-canvas/75 px-1.5 py-0.5 text-center text-sm font-semibold leading-tight backdrop-blur-sm", locked ? "text-white/60" : "text-white/90")}>{stone.title}</p>
      {isNext && <span className="-mt-1 rounded-full bg-sky-400/20 px-2 py-0.5 text-xs font-bold text-sky-200">Up next</span>}
    </div>
  );
}

function Legend({ counts }: { counts: PathView["counts"] }) {
  const items = [
    { label: "Ready", count: counts.ready, dot: "bg-sky-400" },
    { label: "Mastered", count: counts.mastered, dot: "bg-emerald-400" },
    { label: "Review", count: counts.needsReview, dot: "bg-rose-500" },
    ...(counts.dueForReview ? [{ label: "Due", count: counts.dueForReview, dot: "bg-amber-300" }] : []),
  ];
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs font-semibold text-white/70" aria-label="Map key">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("h-2.5 w-2.5 rounded-full", item.dot)} />
          {item.label} {item.count}
        </li>
      ))}
    </ul>
  );
}

function EmptyPath({ onAddBook }: { onAddBook: () => void }) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="flex flex-col items-center gap-6">
      <GlassCard glow="blue" className="w-full p-7 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-sky-400/20 text-sky-300">
          <BookPlus aria-hidden className="h-8 w-8" strokeWidth={2.5} />
        </div>
        <h2 className="mt-4 text-2xl font-bold">Add your first school book</h2>
        <p className="mt-2 text-white/75">Type its name or snap its table of contents. Your path builds itself, one stepping stone at a time.</p>
        <GlossyButton variant="blue" size="lg" className="mt-6" onClick={onAddBook} icon={<Sparkles className="h-5 w-5" strokeWidth={2.5} />}>
          Add a book
        </GlossyButton>
      </GlassCard>
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="max-w-xs font-semibold text-white/75">Notes, photos and missed questions go in the same way: tap the + below anytime.</p>
        <motion.span
          aria-hidden
          animate={reduceMotion ? undefined : { y: [0, 8, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          className="text-violet-300"
        >
          <ArrowDown className="h-7 w-7" strokeWidth={2.5} />
        </motion.span>
      </div>
    </div>
  );
}

function PathSkeleton() {
  return (
    <div className="flex flex-col items-center gap-6" aria-busy="true" aria-label="Loading your path">
      <div className="shimmer h-4 w-56 rounded-full" />
      <div className="shimmer h-14 w-full rounded-full" />
      <div className="shimmer h-12 w-full rounded-2xl" />
      {OFFSETS.slice(0, 5).map((offset, i) => (
        <div key={i} className="shimmer h-[72px] w-[72px] rounded-full" style={{ transform: `translateX(${offset}px)` }} />
      ))}
    </div>
  );
}
