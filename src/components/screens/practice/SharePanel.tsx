"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, Share2 } from "lucide-react";
import type { ShareKind, ShareLinkView } from "@/lib/api-types";
import { api, shareUrl } from "@/lib/client/api";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { errorText } from "./FullSheet";

// Share a deck (F20): a read-only link to this stone's lesson or its questions. Notebook notes and
// source captions are never in the copy. Links work for 30 days and can be turned off here.

const KIND_LABEL: Record<ShareKind, string> = { lesson: "Lesson", questions: "Questions" };

function liveLink(l: ShareLinkView): boolean {
  return !l.revokedAt && new Date(l.expiresAt).getTime() > Date.now();
}

async function handOff(url: string, title: string): Promise<"shared" | "copied" | "shown"> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "shown";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "shown";
  }
}

export function SharePanel({ stone }: { stone: { id: string; title: string } }) {
  const [links, setLinks] = useState<ShareLinkView[] | null>(null);
  const [busy, setBusy] = useState<ShareKind | string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLinks((await api.shareLinks()).links.filter((l) => l.stoneId === stone.id && liveLink(l)));
    } catch {
      setLinks([]);
    }
  }, [stone.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const share = async (kind: ShareKind) => {
    setBusy(kind);
    setError(null);
    setNote(null);
    try {
      const link = await api.createShareLink(kind, stone.id);
      setLinks((ls) => [link, ...(ls ?? [])]);
      const how = await handOff(shareUrl(link.token), link.title);
      setNote(how === "copied" ? "Link copied. It works for 30 days." : how === "shared" ? "Shared. The link works for 30 days." : "Your link is below. It works for 30 days.");
    } catch (e) {
      setError(errorText(e, "The link didn't save. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const copy = async (link: ShareLinkView) => {
    const how = await handOff(shareUrl(link.token), link.title);
    setNote(how === "shown" ? "Press and hold the link to copy it." : how === "copied" ? "Link copied." : "Shared.");
  };

  const turnOff = async (link: ShareLinkView) => {
    setBusy(link.id);
    setError(null);
    try {
      await api.revokeShareLink(link.id);
      setLinks((ls) => (ls ?? []).filter((l) => l.id !== link.id));
      setNote("That link is off. Anyone who opens it now sees that it has ended.");
    } catch (e) {
      setError(errorText(e, "The link is still on. Try again."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby={`share-${stone.id}`} className="flex w-full flex-col gap-3 text-left">
      <h3 id={`share-${stone.id}`} className="flex items-center gap-2 font-bold">
        <Share2 aria-hidden className="h-4 w-4 text-sky-200" strokeWidth={2.5} />
        Share with a classmate
      </h3>
      <p className="text-sm text-white/70">A read-only link. Your notebook notes never go with it.</p>
      <div className="flex flex-wrap gap-2">
        <GlossyButton onClick={() => void share("lesson")} disabled={busy !== null}>
          {busy === "lesson" ? "Making link..." : "Share the lesson"}
        </GlossyButton>
        <GlossyButton onClick={() => void share("questions")} disabled={busy !== null}>
          {busy === "questions" ? "Making link..." : "Share the questions"}
        </GlossyButton>
      </div>
      {note && (
        <p role="status" className="text-sm font-semibold text-emerald-200">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-rose-200">
          {error}
        </p>
      )}
      {links && links.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Links that are on">
          {links.map((l) => (
            <li key={l.id} className="flex flex-col gap-2 rounded-2xl bg-white/[0.06] p-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Link2 aria-hidden className="h-4 w-4 shrink-0 text-sky-200" strokeWidth={2.5} />
                {KIND_LABEL[l.kind]} · until {new Date(l.expiresAt).toLocaleDateString()}
              </p>
              <input readOnly value={shareUrl(l.token)} aria-label={`${KIND_LABEL[l.kind]} link`} className="min-h-11 w-full rounded-xl bg-black/20 px-3 text-xs text-white/80" onFocus={(e) => e.currentTarget.select()} />
              <div className="flex gap-2">
                <GlossyButton onClick={() => void copy(l)} icon={<Copy className="h-4 w-4" strokeWidth={2.5} />}>
                  Copy
                </GlossyButton>
                <GlossyButton variant="ruby" onClick={() => void turnOff(l)} disabled={busy !== null}>
                  {busy === l.id ? "Turning off..." : "Turn off"}
                </GlossyButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
