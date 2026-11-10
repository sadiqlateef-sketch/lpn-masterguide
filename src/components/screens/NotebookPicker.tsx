"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { NotebookColor, NotebookView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";

// Which NotebookLM notebook new notes go into. Notes without a pick go into "My notes".

export const NOTEBOOK_DOT: Record<NotebookColor, string> = {
  violet: "bg-violet-400",
  sky: "bg-sky-400",
  emerald: "bg-emerald-400",
  amber: "bg-amber-300",
  rose: "bg-rose-400",
  cyan: "bg-cyan-300",
};

export type NotebookChoice = { notebookId: string } | { notebookName: string } | null;

type Props = { value: NotebookChoice; onChange: (choice: NotebookChoice) => void };

const FIELD =
  "min-h-11 w-full rounded-2xl border border-white/15 bg-white/[0.06] px-4 text-base text-white placeholder:text-white/40 focus:border-violet-300/60 focus:outline-none";

export function NotebookPicker({ value, onChange }: Props) {
  const [notebooks, setNotebooks] = useState<NotebookView[] | null>(null);
  const [naming, setNaming] = useState(false);

  useEffect(() => {
    api
      .notebooks()
      .then((r) => setNotebooks(r.notebooks))
      .catch(() => setNotebooks([]));
  }, []);

  const pickedId = value && "notebookId" in value ? value.notebookId : null;
  const newName = value && "notebookName" in value ? value.notebookName : "";

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold text-white/70">Notebook (for notes)</legend>
      <div className="flex flex-wrap gap-2">
        {(notebooks ?? []).map((n) => {
          const active = pickedId === n.id;
          return (
            <button
              key={n.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setNaming(false);
                onChange(active ? null : { notebookId: n.id });
              }}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold",
                active ? "border-white/60 bg-white/15 text-white" : "border-white/15 bg-white/[0.04] text-white/75",
              )}
            >
              <span aria-hidden className={cn("h-2.5 w-2.5 rounded-full", NOTEBOOK_DOT[n.color])} />
              {n.name}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={naming}
          onClick={() => {
            setNaming(!naming);
            onChange(null);
          }}
          className={cn(
            "flex min-h-11 items-center gap-1.5 rounded-full border border-dashed px-4 text-sm font-semibold",
            naming ? "border-violet-300/70 text-violet-100" : "border-white/25 text-white/65",
          )}
        >
          <Plus aria-hidden className="h-4 w-4" strokeWidth={2.5} />
          New notebook
        </button>
      </div>
      {naming && (
        <>
          <label htmlFor="notebook-name" className="sr-only">
            New notebook name
          </label>
          <input
            id="notebook-name"
            value={newName}
            maxLength={80}
            onChange={(e) => onChange(e.target.value.trim() ? { notebookName: e.target.value } : null)}
            placeholder="Pharm notebook"
            className={FIELD}
          />
        </>
      )}
      {notebooks !== null && !pickedId && !naming && <p className="text-xs text-white/50">No pick: notes go into &ldquo;My notes&rdquo;.</p>}
    </fieldset>
  );
}

// The extra fields Magic + sends with a note.
export function notebookFields(choice: NotebookChoice): Record<string, string> {
  if (!choice) return {};
  return "notebookId" in choice ? { notebookId: choice.notebookId } : { notebook: choice.notebookName.trim() };
}
