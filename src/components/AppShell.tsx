"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AmbientCanvas } from "@/components/glass/AmbientCanvas";
import { FloatingGlassDock, type DockTab } from "@/components/glass/FloatingGlassDock";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { CloudOff } from "lucide-react";
import type { GameSummary, PathView } from "@/lib/api-types";
import { api, syncOutbox } from "@/lib/client/api";
import { onBackButton, setupNativeChrome } from "@/lib/client/native";
import { TWO_PANE_QUERY, useMediaQuery } from "@/lib/client/use-media-query";
import { cn } from "@/lib/cn";
import { ensureSession, isConfigured } from "@/lib/client/supabase";
import { LessonPlayer } from "./screens/LessonPlayer";
import { MagicAddSheet, type MagicMode } from "./screens/MagicAddSheet";
import { PathMap } from "./screens/PathMap";
import { PlannerSheet } from "./screens/PlannerSheet";
import { AudioSheet, type AudioChapter } from "./screens/practice/AudioSheet";
import { ClinicalSheet } from "./screens/practice/ClinicalSheet";
import { DrugCardsSheet } from "./screens/practice/DrugCardsSheet";
import { ExamSheet, type ExamOpen } from "./screens/practice/ExamSheet";
import { GameSheet } from "./screens/practice/GameSheet";
import { MistakesSheet } from "./screens/practice/MistakesSheet";
import { NgnSheet } from "./screens/practice/NgnSheet";
import { PracticeHub } from "./screens/practice/PracticeHub";
import { SkillsSheet } from "./screens/practice/SkillsSheet";
import { ReadinessRings } from "./screens/ReadinessRings";
import { ReviewSheet } from "./screens/ReviewSheet";
import { TodayCard } from "./screens/TodayCard";

// Time in one lesson counts toward today's study minutes, up to this much (a lesson left open overnight isn't study).
const MAX_LESSON_MINUTES = 90;

// The practice screen open over the app, if any.
type PracticeSheet =
  | { kind: "game"; game: GameSummary }
  | { kind: "exam"; how: ExamOpen }
  | { kind: "mistakes" }
  | { kind: "drugs" }
  | { kind: "ngn"; stone: { id: string; title: string } }
  | { kind: "skills" }
  | { kind: "clinical" }
  | { kind: "audio"; chapter: AudioChapter };

const TITLES: Record<DockTab, string> = { path: "Your Path", readiness: "Readiness" };

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
  const [practice, setPractice] = useState<PracticeSheet | null>(null);
  const [online, setOnline] = useState(true);
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
      // Answers saved while offline get sent and checked now.
      if ((await syncOutbox().catch(() => 0)) > 0) setProgressKey((k) => k + 1);
    } catch (error) {
      // Offline with a session that needs refreshing: open what's saved on the phone instead.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setBoot({ state: "ready" });
        await loadPath();
        return;
      }
      setBoot({ state: "error", message: error instanceof Error ? error.message : "The app couldn't start." });
    }
  }, [loadPath]);

  useEffect(() => {
    void setupNativeChrome();
    void start();
  }, [start]);

  // Back online: send what waited, then refresh the path and the rings.
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const back = () => {
      update();
      void syncOutbox()
        .catch(() => 0)
        .then(() => {
          setProgressKey((k) => k + 1);
          void loadPath();
        });
    };
    update();
    window.addEventListener("online", back);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", back);
      window.removeEventListener("offline", update);
    };
  }, [loadPath]);

  // Android back button: close whatever is on top, then go back to the path, then leave the app.
  const backState = useRef({ lesson: false, review: false, planner: false, practice: false, magic: false, tab });
  useEffect(() => {
    backState.current = { lesson: lessonStone !== null, review: reviewStone !== null, planner: plannerOpen, practice: practice !== null, magic: magic.open, tab };
  }, [lessonStone, reviewStone, plannerOpen, practice, magic.open, tab]);
  useEffect(
    () =>
      onBackButton(() => {
        const current = backState.current;
        if (current.lesson) setLessonStone(null);
        else if (current.review) setReviewStone(null);
        else if (current.planner) setPlannerOpen(false);
        else if (current.practice) setPractice(null);
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

  // Practice answers count toward readiness, so its rings and the hub reload after a round.
  const bumpProgress = useCallback(() => setProgressKey((k) => k + 1), []);
  const closePractice = useCallback(() => {
    setPractice(null);
    setProgressKey((k) => k + 1);
  }, []);

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
  const covered = magic.open || reviewStone !== null || plannerOpen || practice !== null || (lessonStone !== null && !wide);
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
          <h1 className="mt-1 text-3xl font-bold text-white">{TITLES[tab]}</h1>
        </header>

        {!online && (
          <p role="status" className="flex items-center gap-2 rounded-2xl bg-sky-400/10 px-4 py-3 text-sm font-semibold text-sky-100">
            <CloudOff aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.5} />
            You&apos;re offline. Chapters you saved still open, and answers wait here until you&apos;re back.
          </p>
        )}

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
                onListen={(chapter) => setPractice({ kind: "audio", chapter })}
              />
            </>
          ) : (
            boot.state === "ready" && (
              <>
                <ReadinessRings
                  refreshKey={progressKey}
                  hasPath={hasPath}
                  onOpenStone={setLessonStone}
                  onGoToPath={() => setTab("path")}
                  onAddBook={() => setMagic({ open: true, mode: "book" })}
                />
                {/* Practice lives under the rings it raises, so the dock keeps its three buttons. */}
                <PracticeHub
                  path={path}
                  refreshKey={progressKey}
                  onOpenGame={(game) => setPractice({ kind: "game", game })}
                  onOpenExam={(how) => setPractice({ kind: "exam", how })}
                  onOpenMistakes={() => setPractice({ kind: "mistakes" })}
                  onOpenDrugs={() => setPractice({ kind: "drugs" })}
                  onOpenNgn={(stone) => setPractice({ kind: "ngn", stone })}
                  onOpenSkills={() => setPractice({ kind: "skills" })}
                  onOpenClinical={() => setPractice({ kind: "clinical" })}
                />
              </>
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
      <GameSheet game={practice?.kind === "game" ? practice.game : null} onClose={closePractice} onPlayed={bumpProgress} />
      <ExamSheet open={practice?.kind === "exam" ? practice.how : null} onClose={closePractice} onChanged={bumpProgress} />
      <MistakesSheet open={practice?.kind === "mistakes"} onClose={closePractice} onChanged={bumpProgress} />
      <DrugCardsSheet open={practice?.kind === "drugs"} onClose={closePractice} onChanged={bumpProgress} />
      <NgnSheet stone={practice?.kind === "ngn" ? practice.stone : null} onClose={closePractice} onChanged={bumpProgress} />
      <SkillsSheet open={practice?.kind === "skills"} onClose={closePractice} onChanged={bumpProgress} />
      <ClinicalSheet open={practice?.kind === "clinical"} onClose={closePractice} onChanged={bumpProgress} />
      <AudioSheet chapter={practice?.kind === "audio" ? practice.chapter : null} onClose={closePractice} onChanged={bumpProgress} />
      <PlannerSheet open={plannerOpen} path={path} onClose={() => setPlannerOpen(false)} onSaved={refreshProgress} />
    </AmbientCanvas>
  );
}
