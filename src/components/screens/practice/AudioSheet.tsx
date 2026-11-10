"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { LessonView, PracticeView } from "@/lib/api-types";
import { lessonTracks, playlistQuestions, type AudioTrack as Track } from "@/lib/ui/audio";
import { api } from "@/lib/client/api";
import { speak, speechAvailable, stopSpeaking } from "@/lib/client/native";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { EndingQuestions } from "./Ending";
import { Busy, errorText, FullSheet, Problem } from "./FullSheet";

// Audio playlist mode (F14): a chapter's lessons read aloud one card after another, for the car or
// the gym. It ends, like every learning section, with NCLEX-style questions from those lessons.

export type AudioChapter = { id: string; title: string; stones: { id: string; title: string }[] };

type Phase =
  | { kind: "loading"; done: number; total: number }
  | { kind: "listening"; tracks: Track[]; questions: PracticeView[] }
  | { kind: "ending"; questions: PracticeView[] }
  | { kind: "error"; message: string; retry: () => void };

export function AudioSheet({ chapter, onClose, onChanged }: { chapter: AudioChapter | null; onClose: () => void; onChanged: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading", done: 0, total: 0 });
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const run = useRef(0);

  const load = useCallback(async (c: AudioChapter) => {
    setIndex(0);
    setPlaying(false);
    setPhase({ kind: "loading", done: 0, total: c.stones.length });
    const lessons: LessonView[] = [];
    try {
      for (const stone of c.stones) {
        lessons.push(await api.lesson(stone.id));
        setPhase({ kind: "loading", done: lessons.length, total: c.stones.length });
      }
      setPhase({ kind: "listening", tracks: lessons.flatMap(lessonTracks), questions: playlistQuestions(lessons) });
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e, "The lessons didn't load. Try again."), retry: () => void load(c) });
    }
  }, []);

  useEffect(() => {
    if (chapter) void load(chapter);
    return () => {
      run.current++;
      void stopSpeaking();
    };
  }, [chapter, load]);

  // Reads the current card; when it ends on its own, moves to the next one, then to the questions.
  useEffect(() => {
    if (phase.kind !== "listening" || !playing) return;
    const track = phase.tracks[index];
    if (!track) return;
    const mine = ++run.current;
    void speak(track.text).then(
      () => {
        if (run.current !== mine) return;
        if (index + 1 < phase.tracks.length) setIndex(index + 1);
        else {
          setPlaying(false);
          setPhase({ kind: "ending", questions: phase.questions });
        }
      },
      () => {
        if (run.current === mine) setPlaying(false);
      },
    );
  }, [phase, index, playing]);

  const pause = () => {
    run.current++;
    setPlaying(false);
    void stopSpeaking();
  };

  const jump = (by: -1 | 1) => {
    if (phase.kind !== "listening") return;
    run.current++;
    void stopSpeaking();
    setIndex((i) => Math.max(0, Math.min(phase.tracks.length - 1, i + by)));
  };

  const close = () => {
    pause();
    onClose();
  };

  const track = phase.kind === "listening" ? phase.tracks[index] : undefined;

  return (
    <FullSheet open={chapter !== null} title={`Listen: ${chapter?.title ?? ""}`} icon={<Headphones />} tone="text-violet-200" onClose={close}>
      <GlassCard glow="violet" className="p-6">
        {phase.kind === "loading" && <Busy label={phase.total ? `Getting lesson ${Math.min(phase.done + 1, phase.total)} of ${phase.total}...` : "Getting your lessons..."} />}
        {phase.kind === "error" && <Problem message={phase.message} onRetry={phase.retry} onClose={close} />}
        {phase.kind === "listening" && !speechAvailable() && <Problem message="This phone can't read aloud. Open the lessons on your path to read them instead." onClose={close} />}
        {phase.kind === "listening" && speechAvailable() && track && (
          <div className="flex flex-col gap-5">
            <div aria-live="polite">
              <p className="text-xs font-bold uppercase tracking-wide text-violet-200/80">
                {index + 1} of {phase.tracks.length} · {track.stoneTitle}
              </p>
              <p className="mt-2 text-2xl font-bold leading-snug">{track.title}</p>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
              <div className="h-full rounded-full bg-violet-300" style={{ width: `${Math.round(((index + 1) / phase.tracks.length) * 100)}%` }} />
            </div>
            <div className="flex items-center justify-center gap-4">
              <GlossyButton size="icon" onClick={() => jump(-1)} disabled={index === 0} aria-label="Previous card" icon={<SkipBack className="h-6 w-6" strokeWidth={2.5} />} />
              {playing ? (
                <GlossyButton size="lg" variant="violet" onClick={pause} icon={<Pause className="h-6 w-6" strokeWidth={2.5} />}>
                  Pause
                </GlossyButton>
              ) : (
                <GlossyButton size="lg" variant="violet" onClick={() => setPlaying(true)} icon={<Play className="h-6 w-6" strokeWidth={2.5} />}>
                  {index === 0 ? "Play" : "Keep going"}
                </GlossyButton>
              )}
              <GlossyButton
                size="icon"
                onClick={() => jump(1)}
                disabled={index + 1 >= phase.tracks.length}
                aria-label="Next card"
                icon={<SkipForward className="h-6 w-6" strokeWidth={2.5} />}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                pause();
                setPhase({ kind: "ending", questions: phase.questions });
              }}
              className="min-h-11 text-sm font-semibold text-white/60 underline-offset-4 hover:underline"
            >
              Skip to the questions
            </button>
          </div>
        )}
        {phase.kind === "ending" &&
          (phase.questions.length ? (
            <EndingQuestions
              title="Questions from what you heard"
              items={phase.questions}
              onDone={() => {
                onChanged();
                close();
              }}
            />
          ) : (
            <Problem message="That's the whole chapter." onClose={close} />
          ))}
      </GlassCard>
    </FullSheet>
  );
}
