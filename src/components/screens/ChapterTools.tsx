"use client";

import { useEffect, useMemo, useState } from "react";
import { CloudDownload, CloudOff, Headphones } from "lucide-react";
import type { PathModule } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { forgetModule, markModuleSaved, savedModules } from "@/lib/client/offline";
import { cn } from "@/lib/cn";

// Under a chapter's title on the path: save its lessons on the phone for offline study (F12), or
// listen to them as one playlist (F14). Only stones that are open count; locked ones come later.

type Props = { module: PathModule; onListen: (module: { id: string; title: string; stones: { id: string; title: string }[] }) => void };

const chip =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/[0.08] px-4 text-xs font-semibold text-white/85 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-60";

export function ChapterTools({ module, onListen }: Props) {
  const open = useMemo(() => module.stones.filter((s) => s.status !== "locked"), [module.stones]);
  const openKey = open.map((s) => s.id).join(",");
  const [saved, setSaved] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const ids = openKey.split(",").filter(Boolean);
    void savedModules().then((all) => {
      const entry = all.find((m) => m.id === module.id);
      if (live) setSaved(Boolean(entry && ids.every((id) => entry.stoneIds.includes(id))));
    });
    return () => {
      live = false;
    };
  }, [module.id, openKey]);

  if (open.length === 0) return null;

  const save = async () => {
    setMessage(null);
    setProgress({ done: 0, total: open.length });
    let done = 0;
    try {
      for (const stone of open) {
        await api.lesson(stone.id);
        done++;
        setProgress({ done, total: open.length });
      }
      await markModuleSaved({ id: module.id, title: module.title, stoneIds: open.map((s) => s.id) });
      setSaved(true);
      setMessage(`Saved ${open.length} lesson${open.length === 1 ? "" : "s"} on this phone.`);
    } catch (e) {
      setMessage(`Saved ${done} of ${open.length}. ${e instanceof Error ? e.message : "Try again."}`);
    } finally {
      setProgress(null);
    }
  };

  const remove = async () => {
    await forgetModule(module.id);
    setSaved(false);
    setMessage("Removed from this phone.");
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          className={cn(chip, saved && "bg-emerald-400/15 text-emerald-100")}
          onClick={() => void (saved ? remove() : save())}
          disabled={progress !== null}
          aria-pressed={saved}
          aria-label={saved ? `Saved for offline: ${module.title}. Tap to remove it from this phone.` : `Save ${module.title} for offline`}
        >
          {saved ? <CloudOff aria-hidden className="h-4 w-4" strokeWidth={2.5} /> : <CloudDownload aria-hidden className="h-4 w-4" strokeWidth={2.5} />}
          {progress ? `Saving ${progress.done + 1} of ${progress.total}...` : saved ? "Saved offline" : "Save offline"}
        </button>
        <button
          type="button"
          className={chip}
          onClick={() => onListen({ id: module.id, title: module.title, stones: open.map((s) => ({ id: s.id, title: s.title })) })}
          aria-label={`Listen to ${module.title}`}
        >
          <Headphones aria-hidden className="h-4 w-4" strokeWidth={2.5} />
          Listen
        </button>
      </div>
      {message && (
        <p role="status" className="text-center text-xs font-semibold text-white/65">
          {message}
        </p>
      )}
    </div>
  );
}
