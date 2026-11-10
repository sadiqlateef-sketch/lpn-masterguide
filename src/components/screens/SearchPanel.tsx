"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpenText, CircleHelp, Loader2, Lock, NotebookPen, Search, Waypoints } from "lucide-react";
import type { SearchResult, SearchResultKind } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { GLASS_SURFACE } from "@/components/glass/GlassCard";

// One search box for stones, notes, textbook passages and saved questions.
// Tapping a result opens the stone it belongs to, unless that stone is still locked.

type Props = { initialQuery?: string; onOpenStone: (stone: { id: string; title: string }) => void };

const KIND: Record<SearchResultKind, { label: string; Icon: typeof Search; tint: string }> = {
  stone: { label: "Stone", Icon: Waypoints, tint: "text-sky-300" },
  note: { label: "Note", Icon: NotebookPen, tint: "text-violet-300" },
  textbook: { label: "Textbook", Icon: BookOpenText, tint: "text-emerald-300" },
  question: { label: "Question", Icon: CircleHelp, tint: "text-amber-300" },
};

export function SearchPanel({ initialQuery = "", onOpenStone }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  const search = async (q: string) => {
    const value = q.trim();
    if (value.length < 2) return;
    const id = ++run.current;
    setBusy(true);
    setError(null);
    try {
      const { results } = await api.search(value);
      if (id === run.current) setResults(results);
    } catch (e) {
      if (id === run.current) setError(e instanceof Error ? e.message : "Search didn't work. Try again.");
    } finally {
      if (id === run.current) setBusy(false);
    }
  };

  useEffect(() => {
    if (initialQuery.trim().length >= 2) void search(initialQuery);
    // Only the query the sheet opened with runs on its own; later ones run on Search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <label htmlFor="study-search" className="sr-only">
          Search your notes, books and questions
        </label>
        <input
          id="study-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          enterKeyHint="search"
          maxLength={120}
          placeholder="Digoxin, hypokalemia, PPE..."
          className="min-h-12 flex-1 rounded-2xl border border-white/15 bg-white/[0.06] px-4 text-base text-white placeholder:text-white/40 focus:border-sky-300/60 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Search"
          disabled={query.trim().length < 2}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-400/20 text-sky-100 disabled:opacity-40"
        >
          {busy ? <Loader2 aria-hidden className="h-5 w-5 animate-spin" /> : <Search aria-hidden className="h-5 w-5" strokeWidth={2.5} />}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm font-semibold text-rose-200">
          {error}
        </p>
      )}
      {results?.length === 0 && !busy && <p className="py-4 text-center text-white/65">Nothing matched. Try another word.</p>}

      <ul className="flex flex-col gap-2" aria-live="polite">
        {results?.map((r) => {
          const kind = KIND[r.kind];
          const locked = r.stone?.status === "locked";
          const open = r.stone && !locked ? r.stone : null;
          return (
            <li key={`${r.kind}-${r.id}`}>
              <button
                type="button"
                disabled={!open}
                onClick={() => open && onOpenStone(open)}
                className={cn("flex w-full flex-col gap-1 rounded-2xl p-3.5 text-left", GLASS_SURFACE, !open && "cursor-default")}
              >
                <span className={cn("flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide", kind.tint)}>
                  <kind.Icon aria-hidden className="h-4 w-4" strokeWidth={2.5} />
                  {kind.label}
                  {r.kind !== "stone" && <span className="truncate font-semibold normal-case tracking-normal text-white/55">· {r.title}</span>}
                </span>
                {r.kind === "stone" && <span className="font-bold">{r.title}</span>}
                {r.snippet && <span className="text-sm leading-snug text-white/80">{r.snippet}</span>}
                {r.stone && r.kind !== "stone" && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-white/55">
                    {locked && <Lock aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />}
                    {locked ? `${r.stone.title} opens later on your path` : `Open: ${r.stone.title}`}
                  </span>
                )}
                {r.kind === "stone" && locked && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-white/55">
                    <Lock aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />
                    Opens later on your path
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
