"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AmbientCanvas } from "@/components/glass/AmbientCanvas";
import { FloatingGlassDock, type DockTab } from "@/components/glass/FloatingGlassDock";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import type { PathView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { onBackButton, setupNativeChrome } from "@/lib/client/native";
import { ensureSession, isConfigured } from "@/lib/client/supabase";
import { LessonPlayer } from "./screens/LessonPlayer";
import { MagicAddSheet, type MagicMode } from "./screens/MagicAddSheet";
import { PathMap } from "./screens/PathMap";
import { ReadinessRings } from "./screens/ReadinessRings";

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
  const backState = useRef({ lesson: false, magic: false, tab });
  useEffect(() => {
    backState.current = { lesson: lessonStone !== null, magic: magic.open, tab };
  }, [lessonStone, magic.open, tab]);
  useEffect(
    () =>
      onBackButton(() => {
        const current = backState.current;
        if (current.lesson) setLessonStone(null);
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

  const closeLesson = useCallback(() => setLessonStone(null), []);
  const finishLesson = useCallback(() => {
    setLessonStone(null);
    setTab("path");
    refreshProgress();
  }, [refreshProgress]);

  // While a lesson or the Magic + sheet is open, the page behind it can't be tapped or reached by screen readers.
  const covered = magic.open || lessonStone !== null;

  return (
    <AmbientCanvas>
      <main inert={covered} className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 pb-40 pt-[max(2.5rem,env(safe-area-inset-top))]">
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
            <PathMap
              path={path}
              loading={boot.state === "loading" || pathLoading}
              error={pathError}
              onRetry={loadPath}
              onOpenStone={(stone) => setLessonStone({ id: stone.id, title: stone.title })}
              onAddBook={() => setMagic({ open: true, mode: "book" })}
            />
          ) : (
            boot.state === "ready" && <ReadinessRings refreshKey={progressKey} onOpenStone={setLessonStone} />
          ))}
      </main>

      <FloatingGlassDock inert={covered} active={tab} onTabChange={setTab} onMagicAdd={() => setMagic({ open: true, mode: "home" })} />
      <MagicAddSheet
        open={magic.open}
        initialMode={magic.mode}
        onClose={() => setMagic((m) => ({ ...m, open: false }))}
        onAdded={refreshProgress}
        onAccountChanged={refreshProgress}
      />
      <LessonPlayer stone={lessonStone} onClose={closeLesson} onFinished={finishLesson} />
    </AmbientCanvas>
  );
}
