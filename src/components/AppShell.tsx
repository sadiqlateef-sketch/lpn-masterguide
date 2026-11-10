"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AmbientCanvas } from "@/components/glass/AmbientCanvas";
import { FloatingGlassDock, type DockTab } from "@/components/glass/FloatingGlassDock";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import type { PathView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { onBackButton, setupNativeChrome } from "@/lib/client/native";
import { TWO_PANE_QUERY, useMediaQuery } from "@/lib/client/use-media-query";
import { cn } from "@/lib/cn";
import { ensureSession, isConfigured } from "@/lib/client/supabase";
import { LessonPlayer } from "./screens/LessonPlayer";
import { MagicAddSheet, type MagicMode } from "./screens/MagicAddSheet";
import { PathMap } from "./screens/PathMap";
import { PlannerSheet } from "./screens/PlannerSheet";
import { ReadinessRings } from "./screens/ReadinessRings";
import { ReviewSheet } from "./screens/ReviewSheet";
import { TodayCard } from "./screens/TodayCard";

// Time in one lesson counts toward today's study minutes, up to this much (a lesson left open overnight isn't study).
const MAX_LESSON_MINUTES = 90;

type Boot = { state: "loading" } | { state: "ready" } | { state: "error"; message: string } | { state: "unconfigured" };

export function AppShell() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [tab, setTab] = useState<DockTab>("path");
  const [path, setPath] = useState<PathView | null>(null);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [progressKey, setProgressKey] = useState(0);
  const [magic, setMagic] = useState<{ open: boolean; mode: MagicMode }>({ open: false, mode: "home" });
  const [lessonStone, setLessonStone] = useState<{ id: string; title: string } | null>(null);
  const [reviewStone, setReviewStone] = useState<{ id: string; title: string } | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const lessonOpenedAt = useRef<number | null>(null);

  const loadPath = useCallback(async () => {
    setPathLoading(true);
    setPathError(null);
    try {
      setPath(await api.path());
    } catch (error) {
      setPathError(error instanceof Error ? error.message : "Your path didn't load.");
    } finally {
      setPathLoading(false);
    }
  }, []);

  const start = useCallback(async () => {
    if (!isConfigured()) {
      setBoot({ state: "unconfigured" });
      return;
    }
    setBoot({ state: "loading" });
    try {
      await ensureSession();
      setBoot({ state: "ready" });
      await loadPath();
    } catch (error) {
      setBoot({ state: "error", message: error instanceof Error ? error.message : "The app couldn't start." });
    }
  }, [loadPath]);

  useEffect(() => {
    void setupNativeChrome();
    void start();
  }, [start]);

  // Android back button: close whatever is on top, then go back to the path, then leave the app.
  const backState = useRef({ lesson: false, review: false, planner: false, magic: false, tab });
  useEffect(() => {
    backState.current = { lesson: lessonStone !== null, review: reviewStone !== null, planner: plannerOpen, magic: magic.open, tab };
  }, [lessonStone, reviewStone, plannerOpen, magic.open, tab]);
  useEffect(
    () =>
      onBackButton(() => {
        const current = backState.current;
        if (current.lesson) setLessonStone(null);
        else if (current.review) setReviewStone(null);
        else if (current.planner) setPlannerOpen(false);
        else if (current.magic) setMagic((m) => ({ ...m, open: false }));
        else if (current.tab !== "path") setTab("path");
        else return false;
        return true;
      }),
    [],
  );

  const refreshProgress = useCallback(() => {
    setProgressKey((k) => k + 1);
    void loadPath();
  }, [loadPath]);

  // Counts the minutes since the lesson opened toward today, once, when it closes.
  useEffect(() => {
    if (lessonStone) {
      lessonOpenedAt.current = Date.now();
      return;
    }
    const opened = lessonOpenedAt.current;
    lessonOpenedAt.current = null;
    if (opened === null) return;
    const minutes = Math.min(MAX_LESSON_MINUTES, Math.round((Date.now() - opened) / 60000));
    if (minutes >= 1) api.logStudyMinutes(minutes).catch(() => undefined);
  }, [lessonStone]);

  const closeLesson = useCallback(() => {
    setLessonStone(null);
    setProgressKey((k) => k + 1);
  }, []);
  const finishLesson = useCallback(() => {
    setLessonStone(null);
    setTab("path");
    refreshProgress();
  }, [refreshProgress]);

  // On a wide screen (an unfolded Fold, a tablet) the lesson opens beside the path instead of over it.
  const wide = useMediaQuery(TWO_PANE_QUERY);
  const twoPane = wide && lessonStone !== null;

  // While a full-screen lesson or the Magic + sheet is open, the page behind it can't be tapped or reached by screen readers.
  const covered = magic.open || reviewStone !== null || plannerOpen || (lessonStone !== null && !wide);
  const hasPath = (path?.courses.length ?? 0) > 0;

  return (
    <AmbientCanvas>
      <main
        inert={covered}
        className={cn(
          "mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 pt-[max(2.5rem,var(--safe-top))]",
          // Room for the floating dock and the phone's gesture bar, so the last card always scrolls clear of both.
          "pb-[calc(var(--dock-space)+2.5rem)]",
          twoPane && "mx-0 w-1/2 max-w-none px-6",
        )}
      >
        <header>
          <p className="text-sm font-semibold uppercase tracking-widest text-sky-300">LPN MasterGuide</p>
          <h1 className="mt-1 text-3xl font-bold text-white">{tab === "path" ? "Your Path" : "Readiness"}</h1>
        </header>

        {boot.state === "unconfigured" && (
          <GlassCard glow="amber" role="alert">
            <p className="text-lg font-semibold">This copy of the app isn&apos;t connected yet.</p>
            <p className="mt-2 text-white/70">Add the Supabase keys from docs/SETUP.md to .env.local, then restart it.</p>
          </GlassCard>
        )}
        {boot.state === "error" && (
          <GlassCard glow="ruby" role="alert">
            <p className="text-lg font-semibold">{boot.message}</p>
            <GlossyButton variant="ruby" className="mt-4" onClick={start}>
              Try again
            </GlossyButton>
          </GlassCard>
        )}
        {(boot.state === "loading" || boot.state === "ready") &&
          (tab === "path" ? (
            <>
              {boot.state === "ready" && hasPath && (
                <TodayCard
                  refreshKey={progressKey}
                  onOpenStone={setLessonStone}
                  onReview={setReviewStone}
                  onOpenPlanner={() => setPlannerOpen(true)}
                />
              )}
              <PathMap
                path={path}
                loading={boot.state === "loading" || pathLoading}
                error={pathError}
                onRetry={loadPath}
                onOpenStone={(stone) => setLessonStone({ id: stone.id, title: stone.title })}
                onAddBook={() => setMagic({ open: true, mode: "book" })}
              />
            </>
          ) : (
            boot.state === "ready" && (
              <ReadinessRings
                refreshKey={progressKey}
                hasPath={hasPath}
                onOpenStone={setLessonStone}
                onGoToPath={() => setTab("path")}
                onAddBook={() => setMagic({ open: true, mode: "book" })}
              />
            )
          ))}
      </main>

      {/* Fades the page out under the dock, so nothing peeks out between the dock and the screen edge. */}
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-0 left-0 z-40 h-[calc(var(--dock-space)+1.5rem)] bg-gradient-to-t from-canvas from-35% via-canvas/80 to-transparent"
        style={{ right: twoPane ? "50%" : 0 }}
      />
      <FloatingGlassDock
        inert={covered}
        active={tab}
        onTabChange={setTab}
        onMagicAdd={() => setMagic({ open: true, mode: "home" })}
        style={twoPane ? { right: "50%" } : undefined}
      />
      <MagicAddSheet
        open={magic.open}
        initialMode={magic.mode}
        onClose={() => setMagic((m) => ({ ...m, open: false }))}
        onAdded={refreshProgress}
        onAccountChanged={refreshProgress}
        onOpenStone={setLessonStone}
      />
      <LessonPlayer stone={lessonStone} pane={wide} onClose={closeLesson} onFinished={finishLesson} />
      <ReviewSheet
        stone={reviewStone}
        onClose={() => setReviewStone(null)}
        onSaved={refreshProgress}
        onRelearn={(stone) => {
          setReviewStone(null);
          setLessonStone(stone);
        }}
      />
      <PlannerSheet open={plannerOpen} path={path} onClose={() => setPlannerOpen(false)} onSaved={refreshProgress} />
    </AmbientCanvas>
  );
}
