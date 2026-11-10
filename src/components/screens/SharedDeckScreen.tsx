"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, HelpCircle, Loader2 } from "lucide-react";
import type { SharedDeckView } from "@/lib/api-types";
import { shared } from "@/lib/client/api";
import { AmbientCanvas } from "@/components/glass/AmbientCanvas";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { EMPTY_QUICK_PLAY, QuickPlay, type QuickPlayState } from "./QuickPlay";

// What a classmate sees when they open a share link: the lesson's cards, then its questions.
// Answers are checked on the server and nothing about the visitor is saved.

const CARD_GLOW = { eli10: "cyan", lpn_core: "blue", exam_alert: "amber", notebooklm: "violet", quick_play: "emerald" } as const;

type State = { kind: "loading" } | { kind: "ready"; deck: SharedDeckView } | { kind: "error"; message: string };

export function SharedDeckScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [playing, setPlaying] = useState(false);
  const [play, setPlay] = useState<QuickPlayState>(EMPTY_QUICK_PLAY);
  const [score, setScore] = useState<{ right: number; total: number } | null>(null);

  const load = useCallback(async (t: string) => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "ready", deck: await shared.open(t) });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "This link didn't open." });
    }
  }, []);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t") ?? "";
    setToken(t);
    if (t) void load(t);
    else setState({ kind: "error", message: "This link is missing its code. Ask for the link again." });
  }, [load]);

  return (
    <AmbientCanvas>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 pb-16 pt-[max(2.5rem,var(--safe-top))]">
        <header>
          <p className="text-sm font-semibold uppercase tracking-widest text-sky-300">LPN MasterGuide · shared with you</p>
          <h1 className="mt-1 text-3xl font-bold text-white">{state.kind === "ready" ? state.deck.title : "Study set"}</h1>
          {state.kind === "ready" && <p className="mt-1 text-sm text-white/60">This link works until {new Date(state.deck.expiresAt).toLocaleDateString()}.</p>}
        </header>

        {state.kind === "loading" && (
          <p role="status" className="flex items-center gap-2 text-white/70">
            <Loader2 aria-hidden className="h-5 w-5 animate-spin" strokeWidth={2.5} />
            Opening...
          </p>
        )}
        {state.kind === "error" && (
          <GlassCard glow="ruby" role="alert">
            <p className="text-lg font-semibold">{state.message}</p>
            {token && (
              <GlossyButton variant="ruby" className="mt-4" onClick={() => void load(token)}>
                Try again
              </GlossyButton>
            )}
          </GlassCard>
        )}

        {state.kind === "ready" && (
          <>
            {state.deck.cards.length > 0 && (
              <section aria-labelledby="shared-cards" className="flex flex-col gap-4">
                <h2 id="shared-cards" className="flex items-center gap-2 text-lg font-bold">
                  <BookOpen aria-hidden className="h-5 w-5 text-sky-200" strokeWidth={2.5} />
                  The lesson
                </h2>
                {state.deck.cards.map((card, i) => (
                  <GlassCard key={i} glow={CARD_GLOW[card.kind]}>
                    <h3 className="text-xl font-bold leading-snug">{card.title}</h3>
                    {card.body && <p className="mt-2 leading-relaxed text-white/85">{card.body}</p>}
                    {card.bullets && card.bullets.length > 0 && (
                      <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-white/85">
                        {card.bullets.slice(0, 3).map((b, j) => (
                          <li key={j}>{b}</li>
                        ))}
                      </ul>
                    )}
                  </GlassCard>
                ))}
              </section>
            )}

            {state.deck.items.length > 0 && (
              <section aria-labelledby="shared-questions" className="flex flex-col gap-3">
                <h2 id="shared-questions" className="flex items-center gap-2 text-lg font-bold">
                  <HelpCircle aria-hidden className="h-5 w-5 text-emerald-200" strokeWidth={2.5} />
                  NCLEX-style questions
                </h2>
                <GlassCard glow="emerald" className="p-6">
                  {score && !playing ? (
                    <div className="flex flex-col items-center gap-3 text-center" role="status">
                      <p className="text-4xl font-black">
                        {score.right}
                        <span className="text-xl text-white/50"> / {score.total}</span>
                      </p>
                      <GlossyButton
                        variant="emerald"
                        onClick={() => {
                          setPlay(EMPTY_QUICK_PLAY);
                          setScore(null);
                          setPlaying(true);
                        }}
                      >
                        Try them again
                      </GlossyButton>
                    </div>
                  ) : playing && token ? (
                    <QuickPlay
                      stoneId=""
                      stoneTitle={state.deck.title}
                      items={state.deck.items}
                      state={play}
                      setState={setPlay}
                      grader={async (body) => ({ attemptId: "", ...(await shared.answer(token, body)) })}
                      onDone={() => setPlaying(false)}
                      onRoundDone={(right, total) => {
                        setScore({ right, total });
                        setPlaying(false);
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-center">
                      <p className="font-semibold">
                        {state.deck.items.length} question{state.deck.items.length === 1 ? "" : "s"}, each with the reason for every choice.
                      </p>
                      <GlossyButton variant="emerald" size="lg" onClick={() => setPlaying(true)}>
                        Start
                      </GlossyButton>
                    </div>
                  )}
                </GlassCard>
              </section>
            )}
            <p className="text-center text-xs text-white/50">Your answers aren&apos;t saved or seen by anyone.</p>
          </>
        )}
      </main>
    </AmbientCanvas>
  );
}
