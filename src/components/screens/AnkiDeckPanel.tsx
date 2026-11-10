"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronLeft, Download, Layers, Loader2, Sparkles, Trash2, Upload, X } from "lucide-react";
import type { CardCheckView, CardSuggestionView, CardVerdict, DeckView } from "@/lib/api-types";
import { api, ClientApiError, downloadFile } from "@/lib/client/api";
import { uploadDeck } from "@/lib/client/deck-upload";
import { isNative } from "@/lib/client/native";
import { cn } from "@/lib/cn";
import { GLASS_SURFACE } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";

// "Anki deck": add a deck, fact-check its cards against the student's books and notes, decide on each flag,
// accept suggested cards for thin stones, and (on the web) export the checked deck back to Anki.
// Nothing on a card changes until the student taps Accept.

type Props = { onAdded: () => void };

const CAP_STEP = 200;

function message(error: unknown): string {
  return error instanceof ClientApiError || error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function deckLine(deck: DeckView): string {
  if (deck.state === "importing") return "Adding cards...";
  if (deck.state === "failed") return deck.error ?? "Adding this deck didn't finish.";
  const parts = [`${deck.cards} cards`, `${deck.checked} checked`];
  if (deck.flagsPending) parts.push(`${deck.flagsPending} to review`);
  return parts.join(" · ");
}

const VERDICT_LABEL: Record<CardVerdict, string> = {
  agrees: "Matches your sources",
  disagrees: "Doesn't match your sources",
  outdated: "Out of date",
  out_of_scope: "Not LPN content",
  no_source: "Not in your sources yet",
};

export function AnkiDeckPanel({ onAdded }: Props) {
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState<"uploading" | "reading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api
      .decks()
      .then((r) => setDecks(r.decks))
      .catch((e: unknown) => setError(message(e)));
  }, []);
  useEffect(load, [load]);

  const add = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const deck = await uploadDeck(file, setAdding);
      setDecks((d) => [deck, ...(d ?? []).filter((x) => x.id !== deck.id)]);
      setOpenId(deck.id);
      onAdded();
    } catch (e) {
      setError(message(e));
    } finally {
      setAdding(null);
    }
  };

  const open = decks?.find((d) => d.id === openId) ?? null;
  if (open) {
    return (
      <DeckDetail
        deck={open}
        onBack={() => {
          setOpenId(null);
          load();
        }}
        onChanged={(deck) => setDecks((d) => (d ?? []).map((x) => (x.id === deck.id ? deck : x)))}
        onDeleted={() => {
          setOpenId(null);
          setDecks((d) => (d ?? []).filter((x) => x.id !== open.id));
        }}
        onAdded={onAdded}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <input ref={fileInput} type="file" accept=".apkg,.colpkg,.txt,.tsv,.csv" hidden onChange={(e) => void add(e.target.files?.[0])} />
      <p className="text-sm leading-snug text-white/70">
        Add a deck from Anki (.apkg, or a plain-text export). Each card is checked against your own books and notes, and nothing on a card
        changes until you accept it.
      </p>
      {adding ? (
        <div className="flex flex-col items-center gap-3 py-5 text-center" role="status" aria-live="polite">
          <Loader2 aria-hidden className="h-10 w-10 animate-spin text-amber-300" strokeWidth={2.5} />
          <p className="font-semibold">{adding === "uploading" ? "Uploading the deck..." : "Reading the cards and filing them under your stones..."}</p>
          <p className="text-sm text-white/55">Keep the app open. A big deck takes a minute or two.</p>
        </div>
      ) : (
        <GlossyButton variant="amber" size="lg" icon={<Upload aria-hidden className="h-5 w-5" strokeWidth={2.5} />} onClick={() => fileInput.current?.click()}>
          Add an Anki deck
        </GlossyButton>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-rose-200">
          {error}
        </p>
      )}
      {decks === null && !error && <Loader2 aria-label="Loading your decks" className="mx-auto h-8 w-8 animate-spin text-white/60" />}
      {decks?.map((deck) => (
        <button
          key={deck.id}
          type="button"
          onClick={() => setOpenId(deck.id)}
          className={cn(
            "flex min-h-16 w-full items-center gap-3 rounded-3xl p-4 text-left",
            GLASS_SURFACE,
            "shadow-[inset_0_1px_1px_rgba(255,255,255,0.35)] focus-visible:outline-2 focus-visible:outline-amber-300",
          )}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-amber-300/30 to-amber-600/20 text-amber-200">
            <Layers aria-hidden className="h-6 w-6" strokeWidth={2.5} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-bold">{deck.name}</span>
            <span className="text-sm text-white/60">{deckLine(deck)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

type DetailProps = {
  deck: DeckView;
  onBack: () => void;
  onChanged: (deck: DeckView) => void;
  onDeleted: () => void;
  onAdded: () => void;
};

function DeckDetail({ deck, onBack, onChanged, onDeleted, onAdded }: DetailProps) {
  const [flags, setFlags] = useState<CardCheckView[]>([]);
  const [counts, setCounts] = useState<Record<CardVerdict, number> | null>(null);
  const [suggestions, setSuggestions] = useState<CardSuggestionView[]>([]);
  const [running, setRunning] = useState<null | { kind: "check"; done: number } | { kind: "suggest"; added: number }>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const stop = useRef(false);

  const refresh = useCallback(async () => {
    const [checks, sugg] = await Promise.all([api.deckChecks(deck.id), api.deckSuggestions(deck.id)]);
    setFlags(checks.pending);
    setCounts(checks.counts);
    setSuggestions(sugg.suggestions);
  }, [deck.id]);

  useEffect(() => {
    refresh().catch((e: unknown) => setError(message(e)));
    return () => {
      stop.current = true;
    };
  }, [refresh]);

  const runCheck = async () => {
    setError(null);
    setNotice(null);
    stop.current = false;
    let done = 0;
    setRunning({ kind: "check", done });
    try {
      for (;;) {
        const progress = await api.checkDeck(deck.id);
        done += progress.checkedNow;
        onChanged(progress.deck);
        setRunning({ kind: "check", done });
        if (progress.remaining === 0) {
          setNotice(`Every card is checked.`);
          break;
        }
        if (progress.capReached) {
          setNotice(`This deck reached its limit of ${progress.deck.checkCap} checks. ${progress.remaining} cards are left; raise the limit to check them.`);
          break;
        }
        if (progress.checkedNow === 0 || stop.current) break;
      }
      await refresh();
    } catch (e) {
      setError(message(e));
      await refresh().catch(() => undefined);
    } finally {
      setRunning(null);
    }
  };

  const runSuggest = async () => {
    setError(null);
    setNotice(null);
    stop.current = false;
    let added = 0;
    setRunning({ kind: "suggest", added });
    try {
      for (;;) {
        const result = await api.suggestCards(deck.id);
        added += result.added;
        setSuggestions(result.suggestions);
        setRunning({ kind: "suggest", added });
        if (result.stonesLeft === 0 || stop.current) break;
      }
      setNotice(added ? `${added} new cards to look at.` : "Every stone this deck covers already has enough cards, or nothing new to add.");
      onChanged(await api.deck(deck.id));
    } catch (e) {
      setError(message(e));
    } finally {
      setRunning(null);
    }
  };

  const raiseCap = async () => {
    setError(null);
    try {
      onChanged(await api.setDeckCap(deck.id, Math.min(2000, deck.checkCap + CAP_STEP)));
      setNotice(null);
    } catch (e) {
      setError(message(e));
    }
  };

  const decideFlag = async (flag: CardCheckView, decision: "accepted" | "dismissed") => {
    setError(null);
    try {
      await api.decideCheck(flag.id, decision);
      setFlags((f) => f.filter((x) => x.id !== flag.id));
      onChanged(await api.deck(deck.id));
      if (decision === "accepted") onAdded();
    } catch (e) {
      setError(message(e));
    }
  };

  const decideSuggestion = async (s: CardSuggestionView, decision: "accepted" | "dismissed") => {
    setError(null);
    try {
      await api.decideSuggestion(s.id, decision);
      setSuggestions((list) => list.filter((x) => x.id !== s.id));
      onChanged(await api.deck(deck.id));
      if (decision === "accepted") onAdded();
    } catch (e) {
      setError(message(e));
    }
  };

  const exportDeck = async () => {
    setError(null);
    try {
      await downloadFile(`/api/decks/${deck.id}/export`, `${deck.name} (checked).apkg`);
    } catch (e) {
      setError(message(e));
    }
  };

  const remove = async () => {
    setError(null);
    try {
      await api.deleteDeck(deck.id);
      onDeleted();
      onAdded();
    } catch (e) {
      setError(message(e));
    }
  };

  const unchecked = deck.cards - deck.checked;
  const capLeft = Math.max(0, deck.checkCap - deck.checksUsed);
  const ready = deck.state === "ready";

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onBack} className="flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-white/65 hover:text-white">
        <ChevronLeft aria-hidden className="h-4 w-4" strokeWidth={2.5} />
        All decks
      </button>
      <div className={cn("rounded-3xl p-4", GLASS_SURFACE)}>
        <h3 className="text-lg font-bold leading-snug">{deck.name}</h3>
        <p className="mt-1 text-sm text-white/65">
          {deck.cards} cards, {deck.filed} filed under your stones{deck.skipped ? `, ${deck.skipped} skipped (no back or empty)` : ""}.
        </p>
        <p className="text-sm text-white/65">
          {deck.checked} checked. Checks used: {deck.checksUsed} of {deck.checkCap}.
        </p>
        {deck.error && deck.state === "ready" && <p className="mt-1 text-sm text-amber-200">{deck.error}</p>}
        {counts && deck.checked > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
            {(Object.keys(VERDICT_LABEL) as CardVerdict[])
              .filter((v) => counts[v] > 0)
              .map((v) => (
                <li key={v} className="rounded-full bg-white/10 px-3 py-1">
                  {VERDICT_LABEL[v]}: {counts[v]}
                </li>
              ))}
          </ul>
        )}
      </div>

      {running ? (
        <div className="flex flex-col items-center gap-2 py-3 text-center" role="status" aria-live="polite">
          <Loader2 aria-hidden className="h-9 w-9 animate-spin text-amber-300" strokeWidth={2.5} />
          <p className="font-semibold">
            {running.kind === "check" ? `Checking cards... ${running.done} done` : `Looking for gaps... ${running.added} new cards so far`}
          </p>
          <button type="button" className="min-h-11 px-3 text-sm font-semibold text-white/60 hover:text-white" onClick={() => (stop.current = true)}>
            Stop after this batch
          </button>
        </div>
      ) : (
        ready && (
          <div className="flex flex-col gap-2">
            {unchecked > 0 && capLeft > 0 && (
              <GlossyButton variant="amber" size="lg" icon={<Check aria-hidden className="h-5 w-5" strokeWidth={2.5} />} onClick={() => void runCheck()}>
                Check {Math.min(unchecked, capLeft)} cards
              </GlossyButton>
            )}
            {unchecked > 0 && capLeft === 0 && (
              <GlossyButton variant="glass" onClick={() => void raiseCap()} disabled={deck.checkCap >= 2000}>
                Allow {CAP_STEP} more checks
              </GlossyButton>
            )}
            <GlossyButton variant="violet" icon={<Sparkles aria-hidden className="h-5 w-5" strokeWidth={2.5} />} onClick={() => void runSuggest()}>
              Suggest cards for thin stones
            </GlossyButton>
            {!isNative() && (
              <GlossyButton variant="glass" icon={<Download aria-hidden className="h-5 w-5" strokeWidth={2.5} />} onClick={() => void exportDeck()}>
                Export for Anki
              </GlossyButton>
            )}
          </div>
        )
      )}

      {notice && (
        <p role="status" className="text-sm font-semibold text-emerald-200">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-rose-200">
          {error}
        </p>
      )}

      {flags.length > 0 && (
        <section aria-label="Cards to review" className="flex flex-col gap-3">
          <h4 className="mt-2 text-base font-bold">To review ({flags.length})</h4>
          {flags.map((flag) => (
            <FlagCard key={flag.id} flag={flag} onDecide={(d) => decideFlag(flag, d)} />
          ))}
        </section>
      )}

      {suggestions.length > 0 && (
        <section aria-label="Suggested cards" className="flex flex-col gap-3">
          <h4 className="mt-2 text-base font-bold">Suggested cards ({suggestions.length})</h4>
          {suggestions.map((s) => (
            <div key={s.id} className={cn("rounded-3xl p-4", GLASS_SURFACE)}>
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-200">{s.stoneTitle}</p>
              <p className="mt-1 font-bold">{s.front}</p>
              <p className="mt-1 text-white/80">{s.back}</p>
              <Quotes sources={s.sources} />
              <Decide onDecide={(d) => decideSuggestion(s, d)} acceptLabel="Add to deck" dismissLabel="Skip" />
            </div>
          ))}
        </section>
      )}

      <div className="mt-3 flex justify-center">
        {confirmDelete ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-sm text-white/75">Remove this deck and its checks from the app? Your Anki copy isn&apos;t touched.</p>
            <div className="flex gap-2">
              <GlossyButton variant="ruby" onClick={() => void remove()}>
                Remove deck
              </GlossyButton>
              <GlossyButton variant="glass" onClick={() => setConfirmDelete(false)}>
                Keep it
              </GlossyButton>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="flex min-h-11 items-center gap-2 px-3 text-sm font-semibold text-white/50 hover:text-white"
          >
            <Trash2 aria-hidden className="h-4 w-4" strokeWidth={2.5} />
            Remove deck
          </button>
        )}
      </div>
    </div>
  );
}

function FlagCard({ flag, onDecide }: { flag: CardCheckView; onDecide: DecideProps["onDecide"] }) {
  const suspend = flag.suggestion && "action" in flag.suggestion;
  const fix = flag.suggestion && !("action" in flag.suggestion) ? flag.suggestion : null;
  return (
    <div className={cn("rounded-3xl p-4", GLASS_SURFACE)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">
        {VERDICT_LABEL[flag.verdict]}
        {flag.stoneTitle ? ` · ${flag.stoneTitle}` : ""}
      </p>
      <p className="mt-2 text-sm text-white/55">Your card</p>
      <p className="font-bold">{flag.front}</p>
      <p className={cn("text-white/80", fix && "line-through decoration-rose-300/70")}>{flag.back}</p>
      {fix && (
        <>
          <p className="mt-2 text-sm text-white/55">Suggested</p>
          {fix.front !== flag.front && <p className="font-bold">{fix.front}</p>}
          <p className="text-emerald-100">{fix.back}</p>
        </>
      )}
      <p className="mt-2 text-sm leading-snug text-white/75">{flag.explanation}</p>
      <Quotes sources={flag.sources} />
      <Decide onDecide={onDecide} acceptLabel={suspend ? "Suspend card" : "Use the fix"} />
    </div>
  );
}

function Quotes({ sources }: { sources: CardCheckView["sources"] }) {
  if (!sources.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {sources.map((s, i) => (
        <li key={i} className="rounded-2xl bg-white/[0.06] px-3 py-2 text-sm">
          <span className="text-white/85">&ldquo;{s.quote}&rdquo;</span>
          <span className="block text-xs text-white/50">{s.label}</span>
        </li>
      ))}
    </ul>
  );
}

type DecideProps = { onDecide: (d: "accepted" | "dismissed") => Promise<void>; acceptLabel: string; dismissLabel?: string };

function Decide({ onDecide, acceptLabel, dismissLabel = "Keep mine" }: DecideProps) {
  const [busy, setBusy] = useState(false);
  const decide = (d: "accepted" | "dismissed") => {
    setBusy(true);
    void onDecide(d).finally(() => setBusy(false));
  };
  return (
    <div className="mt-3 flex gap-2">
      <GlossyButton variant="emerald" disabled={busy} icon={<CheckCircle2 aria-hidden className="h-4 w-4" strokeWidth={2.5} />} onClick={() => decide("accepted")}>
        {acceptLabel}
      </GlossyButton>
      <GlossyButton variant="glass" disabled={busy} icon={<X aria-hidden className="h-4 w-4" strokeWidth={2.5} />} onClick={() => decide("dismissed")}>
        {dismissLabel}
      </GlossyButton>
    </div>
  );
}
