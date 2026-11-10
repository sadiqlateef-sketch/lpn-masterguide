"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, FolderSync, KeyRound, Loader2, Mail } from "lucide-react";
import type { NoteSourceView } from "@/lib/api-types";
import { api, API_BASE } from "@/lib/client/api";
import { accountInfo, saveAccount, signInWithPassword, type AccountInfo } from "@/lib/client/supabase";
import { cn } from "@/lib/cn";
import { GLASS_SURFACE } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";

// Explains folder sync and handles the one thing it needs from the app: a saved email and password
// the sync script can sign in with. Google logins and NotebookLM cookies are never involved.

type Props = { onAccountChanged: () => void };

const FIELD =
  "min-h-12 w-full rounded-2xl border border-white/15 bg-white/[0.06] px-4 text-base text-white placeholder:text-white/40 focus:border-violet-300/60 focus:outline-none";

export function NotebookSyncPanel({ onAccountChanged }: Props) {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [synced, setSynced] = useState<NoteSourceView[] | null>(null);
  const [mode, setMode] = useState<"save" | "signin">("save");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const [info, sources] = await Promise.all([accountInfo(), api.noteSources().catch(() => ({ sources: [] }))]);
    setAccount(info);
    setSynced(sources.sources.filter((s) => s.externalKey));
  }, []);

  useEffect(() => {
    refresh().catch(() => setMessage({ tone: "error", text: "Couldn't load your account. Check your connection." }));
  }, [refresh]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      setMessage({ tone: "error", text: "Use a password with at least 8 characters." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "save") {
        const { needsConfirmation } = await saveAccount(email.trim(), password);
        setMessage({
          tone: "ok",
          text: needsConfirmation ? "Check your email and tap the link to finish saving your account." : "Your account is saved.",
        });
      } else {
        await signInWithPassword(email.trim(), password);
        setMessage({ tone: "ok", text: "Signed in. Loading your path..." });
        onAccountChanged();
      }
      setPassword("");
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "That didn't work. Try again." });
    } finally {
      setBusy(false);
    }
  };

  // In the Android app the screens run from https://localhost, so use the hosted API address instead.
  const appUrl = API_BASE || (typeof window === "undefined" ? "https://your-app" : window.location.origin);
  const command = `LPN_EMAIL=${account?.email ?? "you@example.com"} \\\n  node scripts/notebooklm-sync.mjs --folder ~/NotebookLM --app ${appUrl} --watch --prune`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command.replace("\\\n  ", ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ tone: "error", text: "Couldn't copy. Select the text and copy it instead." });
    }
  };

  if (!account) {
    return (
      <div className="flex justify-center py-8" role="status" aria-label="Loading">
        <Loader2 aria-hidden className="h-8 w-8 animate-spin text-violet-300" />
      </div>
    );
  }

  const saved = Boolean(account.email);

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-3 text-base leading-snug text-white/85">
        <li className="flex gap-3">
          <Step n={1} done={saved} />
          <span>{saved ? `Account saved as ${account.email}.` : "Save an account so the sync tool can sign in as you."}</span>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <span>Export your NotebookLM notes as PDF, markdown or text into one folder on your computer.</span>
        </li>
        <li className="flex gap-3">
          <Step n={3} />
          <span>Run the sync tool from the app folder. It asks for your password. Edited files replace their old copy, and your lessons update.</span>
        </li>
      </ol>

      {(!saved || mode === "signin") && (
        <form onSubmit={submit} className={cn("flex flex-col gap-3 rounded-3xl p-4", GLASS_SURFACE)}>
          <p className="font-bold">{mode === "save" ? "Save your account" : "Sign in to a saved account"}</p>
          {account.pendingEmail && mode === "save" && (
            <p className="text-sm text-amber-200">Waiting for you to confirm {account.pendingEmail}. Check your email.</p>
          )}
          <label className="sr-only" htmlFor="sync-email">
            Email
          </label>
          <div className="relative">
            <Mail aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/40" />
            <input
              id="sync-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className={cn(FIELD, "pl-12")}
            />
          </div>
          <label className="sr-only" htmlFor="sync-password">
            Password
          </label>
          <div className="relative">
            <KeyRound aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/40" />
            <input
              id="sync-password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "save" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (8+ characters)"
              className={cn(FIELD, "pl-12")}
            />
          </div>
          <GlossyButton type="submit" variant="violet" size="lg" className="justify-center" disabled={busy}>
            {busy ? "Working..." : mode === "save" ? "Save account" : "Sign in"}
          </GlossyButton>
          {mode === "signin" && (
            <p className="text-sm text-white/55">Your path on this phone will switch to the saved account.</p>
          )}
        </form>
      )}

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={cn("text-sm font-semibold", message.tone === "error" ? "text-rose-200" : "text-emerald-200")}>
          {message.text}
        </p>
      )}

      {saved && (
        <div className={cn("flex flex-col gap-3 rounded-3xl p-4", GLASS_SURFACE)}>
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-bold">
              <FolderSync aria-hidden className="h-5 w-5 text-violet-300" strokeWidth={2.5} />
              Sync command
            </p>
            <GlossyButton size="md" onClick={copy} icon={copied ? <Check className="h-4 w-4" strokeWidth={3} /> : <Copy className="h-4 w-4" strokeWidth={2.5} />}>
              {copied ? "Copied" : "Copy"}
            </GlossyButton>
          </div>
          <pre className="overflow-x-auto whitespace-pre rounded-xl bg-black/40 p-3 text-xs leading-relaxed text-violet-100">{command}</pre>
          <p className="text-sm text-white/55">
            {synced === null
              ? "Checking synced files..."
              : synced.length === 0
                ? "No files synced yet."
                : `${synced.length} file${synced.length === 1 ? "" : "s"} synced, like ${synced
                    .slice(0, 2)
                    .map((s) => s.externalKey)
                    .join(" and ")}.`}
          </p>
        </div>
      )}

      <button
        type="button"
        className="mx-auto min-h-11 px-3 text-sm font-semibold text-white/55 hover:text-white"
        onClick={() => {
          setMode(mode === "save" ? "signin" : "save");
          setMessage(null);
        }}
      >
        {mode === "save" ? "Already saved an account on another phone? Sign in" : "Back"}
      </button>
    </div>
  );
}

function Step({ n, done = false }: { n: number; done?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold",
        done ? "bg-emerald-400 text-on-accent" : "bg-violet-400/25 text-violet-100",
      )}
    >
      {done ? <Check className="h-4 w-4" strokeWidth={3} /> : n}
    </span>
  );
}
