"use client";

import { ArrowDown, ArrowUp, CheckCircle2, XCircle } from "lucide-react";
import type { GradeResult, PracticeView } from "@/lib/api-types";
import { haptic } from "@/lib/client/native";
import { moveItem, splitCloze } from "@/lib/quick-play";
import { cn } from "@/lib/cn";

// The newer NGN item types: matrix, drop-down cloze, highlight and ordered response.
// Answers live in the caller's state so a lesson or an exam can keep them across screens.

type Of<T extends PracticeView["type"]> = Extract<PracticeView, { type: T }>;

export function MatrixItem({
  item,
  answer,
  result,
  onChange,
}: {
  item: Of<"matrix">;
  answer: Record<string, string>;
  result: GradeResult | undefined;
  onChange: (next: Record<string, string>) => void;
}) {
  const key = result?.matrix;
  return (
    <>
      <p className="text-lg font-semibold leading-snug">{item.stem}</p>
      <p className="text-sm font-bold text-amber-200">Pick one for each row.</p>
      <div className="flex flex-col gap-3">
        {item.rows.map((row) => {
          const picked = answer[row.id];
          const right = key?.[row.id];
          return (
            <div key={row.id} role="radiogroup" aria-label={row.text} className="flex flex-col gap-2 rounded-2xl bg-white/[0.04] p-3">
              <p className="flex items-start gap-2 font-semibold leading-snug">
                <span className="flex-1">{row.text}</span>
                {key && (right === picked ? <CheckCircle2 aria-label="Right" className="h-5 w-5 shrink-0 text-emerald-300" /> : <XCircle aria-label="Wrong" className="h-5 w-5 shrink-0 text-rose-300" />)}
              </p>
              <div className="flex flex-wrap gap-2">
                {item.columns.map((col) => {
                  const isPicked = picked === col.id;
                  const isRight = right === col.id;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      role="radio"
                      aria-checked={isPicked}
                      disabled={Boolean(result)}
                      onClick={() => {
                        void haptic("tap");
                        onChange({ ...answer, [row.id]: col.id });
                      }}
                      className={cn(
                        "min-h-11 rounded-full border px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-default",
                        !key && (isPicked ? "border-sky-300/70 bg-sky-400/25" : "border-white/15 bg-white/[0.06]"),
                        key && isRight && "border-emerald-300/80 bg-emerald-400/25",
                        key && !isRight && isPicked && "border-rose-300/80 bg-rose-500/25",
                        key && !isRight && !isPicked && "border-white/10 text-white/45",
                      )}
                    >
                      {col.text}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function ClozeItem({
  item,
  answer,
  result,
  onChange,
}: {
  item: Of<"cloze">;
  answer: Record<string, string>;
  result: GradeResult | undefined;
  onChange: (next: Record<string, string>) => void;
}) {
  const key = result?.cloze;
  return (
    <>
      <p className="text-lg font-semibold leading-snug">{item.stem}</p>
      <p className="text-sm font-bold text-amber-200">Choose the best option for each blank.</p>
      <p className="rounded-2xl bg-white/[0.04] p-4 text-base leading-loose">
        {splitCloze(item.text).map((part, i) => {
          if (part.kind === "text") return <span key={i}>{part.text}</span>;
          const blank = item.blanks.find((b) => b.id === part.id);
          if (!blank) return <span key={i}>____</span>;
          const picked = answer[blank.id] ?? "";
          const right = key?.[blank.id];
          return (
            <select
              key={i}
              aria-label={`Blank ${blank.id}`}
              value={picked}
              disabled={Boolean(result)}
              onChange={(e) => onChange({ ...answer, [blank.id]: e.target.value })}
              className={cn(
                "mx-1 inline-block max-w-full rounded-xl border bg-canvas px-2 py-1 text-base font-semibold text-white focus-visible:outline-2 focus-visible:outline-sky-300",
                !key && "border-sky-300/50",
                key && right === picked && "border-emerald-300",
                key && right !== picked && "border-rose-300",
              )}
            >
              <option value="">Select...</option>
              {blank.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.text}
                </option>
              ))}
            </select>
          );
        })}
      </p>
      {key && (
        <ul className="flex flex-col gap-1 text-sm text-emerald-100">
          {item.blanks.map((b) => (
            <li key={b.id}>Blank {b.id}: {b.options.find((o) => o.id === key[b.id])?.text}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export function HighlightItem({
  item,
  picks,
  result,
  onToggle,
}: {
  item: Of<"highlight">;
  picks: string[];
  result: GradeResult | undefined;
  onToggle: (id: string) => void;
}) {
  const right = result?.correctOptionIds;
  return (
    <>
      <p className="text-lg font-semibold leading-snug">{item.stem}</p>
      <p className="text-sm font-bold text-amber-200">Tap each part that applies. Tap again to clear it.</p>
      <p className="rounded-2xl bg-white/[0.04] p-4 text-base leading-loose">
        {item.segments.map((seg) => {
          const picked = picks.includes(seg.id);
          const isRight = right?.includes(seg.id);
          return (
            <button
              key={seg.id}
              type="button"
              aria-pressed={picked}
              disabled={Boolean(result)}
              onClick={() => {
                void haptic("tap");
                onToggle(seg.id);
              }}
              className={cn(
                "mr-1 inline rounded-md px-1 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-default",
                !right && picked && "bg-amber-300/40 text-white",
                !right && !picked && "hover:bg-white/10",
                right && isRight && "bg-emerald-400/35",
                right && !isRight && picked && "bg-rose-500/35 line-through",
              )}
            >
              {seg.text}
            </button>
          );
        })}
      </p>
    </>
  );
}

export function OrderedItem({
  item,
  order,
  result,
  onChange,
}: {
  item: Of<"ordered">;
  order: string[];
  result: GradeResult | undefined;
  onChange: (next: string[]) => void;
}) {
  const key = result?.order;
  const byId = new Map(item.items.map((i) => [i.id, i]));
  return (
    <>
      <p className="text-lg font-semibold leading-snug">{item.stem}</p>
      <p className="text-sm font-bold text-amber-200">Put them in order, first at the top.</p>
      <ol className="flex flex-col gap-2">
        {order.map((id, index) => {
          const it = byId.get(id);
          if (!it) return null;
          const inPlace = key ? key[index] === id : undefined;
          return (
            <li
              key={id}
              className={cn(
                "flex min-h-14 items-center gap-3 rounded-2xl border px-3 py-2",
                inPlace === undefined && "border-white/15 bg-white/[0.06]",
                inPlace === true && "border-emerald-300/80 bg-emerald-400/20",
                inPlace === false && "border-rose-300/80 bg-rose-500/20",
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold">{index + 1}</span>
              <span className="flex-1 leading-snug">{it.text}</span>
              {!result && (
                <span className="flex gap-1">
                  <button
                    type="button"
                    aria-label={`Move "${it.text}" up`}
                    disabled={index === 0}
                    onClick={() => onChange(moveItem(order, index, -1))}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-sky-300"
                  >
                    <ArrowUp className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move "${it.text}" down`}
                    disabled={index === order.length - 1}
                    onClick={() => onChange(moveItem(order, index, 1))}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-sky-300"
                  >
                    <ArrowDown className="h-5 w-5" />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {key && key.some((id, i) => order[i] !== id) && (
        <p className="text-sm text-emerald-100">
          Right order: {key.map((id, i) => `${i + 1}. ${byId.get(id)?.text ?? id}`).join("  ")}
        </p>
      )}
    </>
  );
}
