"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpenText, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import type { TextbookView } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { uploadTextbookPdf, type UploadProgress } from "@/lib/client/textbook-upload";
import { cn } from "@/lib/cn";
import { GLASS_SURFACE } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";

// "Add a whole book (PDF)": pick one of the student's books, then its PDF. Big PDFs are split on the
// phone and sent part by part; each part is read before the next, and the progress shows which one.

type Props = { onAdded: () => void; onAddBook: () => void; onDone: () => void };

type State =
  | { step: "pick" }
  | { step: "working"; book: TextbookView; progress: UploadProgress | null }
  | { step: "done"; message: string }
  | { step: "error"; message: string };

function progressLabel(p: UploadProgress | null): string {
  if (!p || p.stage === "splitting") return "Getting the PDF ready...";
  if (p.stage === "uploading") return p.parts > 1 ? `Uploading part ${p.part} of ${p.parts}...` : "Uploading the book...";
  if (p.stage === "reading") return p.parts > 1 ? `Reading part ${p.part} of ${p.parts}...` : "Reading the book...";
  return "Finishing up...";
}

function bookStatus(book: TextbookView): string {
  if (!book.pdf) return `${book.stones} stones, no PDF yet`;
  const read = book.pdf.uploaded.filter((p) => p.state === "done" || p.state === "no_text").length;
  const parts = book.pdf.parts ?? book.pdf.uploaded.length;
  if (read < parts) return `PDF ${read} of ${parts} parts read. Add the same PDF again to finish.`;
  return `${book.pdf.passages} passages from its PDF`;
}

export function TextbookPdfPanel({ onAdded, onAddBook, onDone }: Props) {
  const [books, setBooks] = useState<TextbookView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ step: "pick" });
  const fileInput = useRef<HTMLInputElement>(null);
  const chosen = useRef<TextbookView | null>(null);

  useEffect(() => {
    api
      .textbooks()
      .then((r) => setBooks(r.textbooks))
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "Your books didn't load."));
  }, []);

  const choose = (book: TextbookView) => {
    chosen.current = book;
    if (fileInput.current) fileInput.current.value = "";
    fileInput.current?.click();
  };

  const send = async (file: File | undefined) => {
    const book = chosen.current;
    if (!file || !book) return;
    setState({ step: "working", book, progress: null });
    try {
      const result = await uploadTextbookPdf(file, book.id, (progress) => setState({ step: "working", book, progress }));
      setState({ step: "done", message: result.message });
      onAdded();
    } catch (error) {
      setState({ step: "error", message: error instanceof Error ? error.message : "The book didn't upload. Try again." });
    }
  };

  const progress = state.step === "working" && state.progress && state.progress.stage !== "splitting" && state.progress.stage !== "done" ? state.progress : null;

  return (
    <div className="flex flex-col gap-3">
      <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void send(e.target.files?.[0])} />

      {state.step === "working" && (
        <div className="flex flex-col items-center gap-4 py-6 text-center" role="status" aria-live="polite">
          <Loader2 aria-hidden className="h-12 w-12 animate-spin text-emerald-300" strokeWidth={2.5} />
          <p className="text-lg font-semibold">{progressLabel(state.progress)}</p>
          {progress && progress.parts > 1 && (
            <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-white/15" aria-hidden>
              <div
                className="h-full rounded-full bg-emerald-300 transition-[width]"
                style={{ width: `${Math.round(((progress.part - (progress.stage === "uploading" ? 1 : 0.5)) / progress.parts) * 100)}%` }}
              />
            </div>
          )}
          <p className="text-sm text-white/55">Keep the app open. A whole book takes a few minutes; parts already read are kept if it stops.</p>
        </div>
      )}

      {state.step === "done" && (
        <div className="flex flex-col items-center gap-4 py-4 text-center" role="status">
          <CheckCircle2 aria-hidden className="h-14 w-14 text-emerald-300" strokeWidth={2.5} />
          <p className="text-lg font-semibold leading-snug">{state.message}</p>
          <GlossyButton variant="emerald" size="lg" onClick={onDone}>
            Done
          </GlossyButton>
        </div>
      )}

      {state.step === "error" && (
        <div className="flex flex-col items-center gap-4 py-4 text-center" role="alert">
          <p className="text-lg font-semibold leading-snug text-rose-200">{state.message}</p>
          <GlossyButton variant="glass" size="lg" onClick={() => setState({ step: "pick" })}>
            Try again
          </GlossyButton>
        </div>
      )}

      {state.step === "pick" && (
        <>
          <p className="text-sm leading-snug text-white/70">
            Pick the book, then its PDF. Lessons will use the real chapter text, with page numbers. The PDF stays private to your account.
          </p>
          {loadError && (
            <p role="alert" className="text-sm font-semibold text-rose-200">
              {loadError}
            </p>
          )}
          {books === null && !loadError && <Loader2 aria-label="Loading your books" className="mx-auto h-8 w-8 animate-spin text-white/60" />}
          {books?.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <p className="text-white/80">Add the book by its title or ISBN first, so its chapters are on your path. Then add its PDF here.</p>
              <GlossyButton variant="emerald" onClick={onAddBook}>
                Add School Book
              </GlossyButton>
            </div>
          )}
          {books?.map((book) => (
            <button
              key={book.id}
              type="button"
              onClick={() => choose(book)}
              className={cn(
                "flex min-h-16 w-full items-center gap-3 rounded-3xl p-4 text-left",
                GLASS_SURFACE,
                "shadow-[inset_0_1px_1px_rgba(255,255,255,0.35)] focus-visible:outline-2 focus-visible:outline-emerald-300",
              )}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-emerald-300/30 to-emerald-600/20 text-emerald-200">
                {book.pdf ? <BookOpenText aria-hidden className="h-6 w-6" strokeWidth={2.5} /> : <FileUp aria-hidden className="h-6 w-6" strokeWidth={2.5} />}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-bold">{book.title}</span>
                <span className="text-sm text-white/60">{bookStatus(book)}</span>
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
