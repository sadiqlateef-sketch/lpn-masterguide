"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import type { PracticeView } from "@/lib/api-types";
import { EMPTY_QUICK_PLAY, QuickPlay, type QuickPlayState } from "../QuickPlay";

// NCLEX-style questions that close a game, a drug card or a mistakes redo. Answers are graded and
// saved like any other question; the last screen calls onDone instead of finishing a lesson.
export function EndingQuestions({ title, items, onDone }: { title: string; items: PracticeView[]; onDone: (right: number, total: number) => void }) {
  const [play, setPlay] = useState<QuickPlayState>(EMPTY_QUICK_PLAY);
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
        <HelpCircle aria-hidden className="h-4 w-4" strokeWidth={2.5} />
        {title}
      </p>
      <QuickPlay stoneId="" stoneTitle={title} items={items} state={play} setState={setPlay} onDone={() => onDone(0, items.length)} onRoundDone={onDone} />
    </div>
  );
}
