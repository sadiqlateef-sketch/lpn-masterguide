"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BookPlus, Camera, CheckCircle2, ChevronLeft, ClipboardPaste, FileText, FolderSync, Images, Loader2, Paperclip, Search, X } from "lucide-react";
import { api, ClientApiError, type BookResult } from "@/lib/client/api";
import { prepareImages } from "@/lib/client/images";
import { isNative, pickPhotos, takePhoto } from "@/lib/client/native";
import { cn } from "@/lib/cn";
import { GLASS_SURFACE } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { NotebookPicker, notebookFields, type NotebookChoice } from "./NotebookPicker";
import { NotebookSyncPanel } from "./NotebookSyncPanel";
import { SearchPanel } from "./SearchPanel";
import { TextbookPdfPanel } from "./TextbookPdfPanel";

export type MagicMode = "home" | "paste" | "book" | "pdf" | "search" | "sync";

type PhotoTarget = "magic" | "toc";

type Phase =
  | { step: "choose" }
  // Android app only: pick between the camera and the photo gallery.
  | { step: "photo-source"; target: PhotoTarget; back: Phase }
  | { step: "working"; label: string }
  | { step: "done"; message: string; needsTocFor?: string | null }
  | { step: "error"; message: string };

type MagicAddSheetProps = {
  open: boolean;
  initialMode?: MagicMode;
  onClose: () => void;
  // Something was saved; the path and readiness should reload.
  onAdded: () => void;
  onAccountChanged: () => void;
  // A search result was tapped: close the sheet and open that stone's lesson.
  onOpenStone: (stone: { id: string; title: string }) => void;
};

const ISBN_PATTERN = /^(?:ISBN[-:\s]*)?(97[89][-\s]?)?(\d[-\s]?){9}[\dXx]$/;
const NOTE_FILES = ".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain";

function errorMessage(error: unknown): string {
  return error instanceof ClientApiError || error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function needsTocTitle(book: BookResult | undefined, fallback: string | null): string | null | undefined {
  if (book?.status !== "needs_toc_photo") return undefined;
  return book.book?.title ?? fallback;
}

export function MagicAddSheet({ open, initialMode = "home", onClose, onAdded, onAccountChanged, onOpenStone }: MagicAddSheetProps) {
  const reduceMotion = useReducedMotion();
  const [mode, setMode] = useState<MagicMode>(initialMode);
  const [phase, setPhase] = useState<Phase>({ step: "choose" });
  const [text, setText] = useState("");
  const [bookText, setBookText] = useState("");
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const [notebook, setNotebook] = useState<NotebookChoice>(null);
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const tocInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const tocTitle = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setPhase({ step: "choose" });
    setText("");
    setBookText("");
    setNoteFiles([]);
    setNotebook(null);
    setSearchText("");
    setSearchQuery("");
  }, [open, initialMode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase.step !== "working") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, phase.step, onClose]);

  useEffect(() => {
    if (open) sheetRef.current?.focus();
  }, [open, mode]);

  const run = async (label: string, work: () => Promise<{ message: string; needsTocFor?: string | null }>) => {
    setPhase({ step: "working", label });
    try {
      const result = await work();
      setPhase({ step: "done", ...result });
      onAdded();
    } catch (error) {
      setPhase({ step: "error", message: errorMessage(error) });
    }
  };

  const sendPhotos = (picked: File[]) => {
    if (!picked.length) return;
    void run("Reading your photo...", async () => {
      const form = new FormData();
      for (const file of await prepareImages(picked)) form.append("files", file);
      const result = await api.magicAdd(form);
      return { message: result.message, needsTocFor: needsTocTitle(result.book, null) };
    });
  };

  const sendTocPhotos = (picked: File[]) => {
    if (!picked.length) return;
    const title = tocTitle.current;
    void run("Reading the chapters...", async () => {
      const form = new FormData();
      if (title) form.append("title", title);
      for (const file of await prepareImages(picked)) form.append("files", file);
      const result = await api.buildSyllabus(form);
      return { message: result.message, needsTocFor: needsTocTitle(result, title) };
    });
  };

  // In the browser the file picker already offers camera and gallery; in the Android app the sheet
  // asks first, then opens the phone's own camera or photo picker.
  const openPhotos = (target: PhotoTarget) => {
    if (isNative()) {
      setPhase((current) => ({ step: "photo-source", target, back: current }));
      return;
    }
    const input = target === "magic" ? photoInput.current : tocInput.current;
    if (!input) return;
    input.value = "";
    input.click();
  };

  const fromPhone = async (target: PhotoTarget, source: "camera" | "gallery") => {
    try {
      const picked = source === "camera" ? [await takePhoto()].filter((f): f is File => f !== null) : await pickPhotos(10);
      if (!picked.length) return; // backed out: stay on the choice
      if (target === "magic") sendPhotos(picked);
      else sendTocPhotos(picked);
    } catch (error) {
      setPhase({ step: "error", message: errorMessage(error) });
    }
  };

  const sendPaste = () => {
    const value = text.trim();
    if (!value && noteFiles.length === 0) return;
    void run(noteFiles.length ? "Saving your notes..." : "Figuring out what this is...", async () => {
      const extra = notebookFields(notebook);
      if (noteFiles.length === 0) {
        const result = await api.magicAdd({ text: value, ...extra });
        return { message: result.message, needsTocFor: needsTocTitle(result.book, value) };
      }
      const form = new FormData();
      if (value) form.append("text", value);
      for (const [key, v] of Object.entries(extra)) form.append(key, v);
      for (const file of noteFiles) form.append("files", file);
      return { message: (await api.magicAdd(form)).message };
    });
  };

  const sendBook = () => {
    const value = bookText.trim();
    if (!value) return;
    void run("Finding the chapters...", async () => {
      const compact = value.replace(/[-\s]/g, "");
      const result = await api.buildSyllabus(ISBN_PATTERN.test(value) ? { isbn: compact.replace(/^ISBN:?/i, "") } : { title: value });
      return { message: result.message, needsTocFor: needsTocTitle(result, value) };
    });
  };

  const pasteFromClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) setText((current) => (current ? `${current}\n${clip}` : clip));
    } catch {
      // Clipboard access was refused; the student can long-press and paste instead.
    }
  };

  const busy = phase.step === "working";
  const title =
    phase.step === "photo-source"
      ? phase.target === "toc"
        ? "Table of contents"
        : "Add a photo"
      : phase.step !== "choose"
      ? "Magic Add"
      : {
          home: "Add anything",
          paste: "Paste a note or question",
          book: "Add a school book",
          pdf: "Add a whole book (PDF)",
          search: "Search",
          sync: "Sync a NotebookLM folder",
        }[mode];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-[55] bg-canvas/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={busy ? undefined : onClose}
            aria-hidden
          />
          <motion.div
            key="sheet"
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className={cn(
              "fixed inset-x-0 bottom-0 z-[56] mx-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-[2rem] px-5 pt-3 text-white outline-none",
              "pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-20px_60px_-10px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.35)]",
              GLASS_SURFACE,
              "bg-slate-900/70",
            )}
          >
            <div aria-hidden className="mx-auto h-1.5 w-12 rounded-full bg-white/25" />
            <div className="mt-3 flex items-center justify-between gap-3">
              {phase.step === "photo-source" ? (
                <GlossyButton size="icon" aria-label="Back" onClick={() => setPhase(phase.back)} icon={<ChevronLeft className="h-6 w-6" strokeWidth={2.5} />} />
              ) : mode !== "home" && phase.step === "choose" ? (
                <GlossyButton size="icon" aria-label="Back" onClick={() => setMode("home")} icon={<ChevronLeft className="h-6 w-6" strokeWidth={2.5} />} />
              ) : (
                <span className="w-12" />
              )}
              <h2 className="text-center text-lg font-bold">{title}</h2>
              <GlossyButton size="icon" aria-label="Close" disabled={busy} onClick={onClose} icon={<X className="h-6 w-6" strokeWidth={2.5} />} />
            </div>

            <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => sendPhotos([...(e.target.files ?? [])])} />
            <input ref={tocInput} type="file" accept="image/*" multiple hidden onChange={(e) => sendTocPhotos([...(e.target.files ?? [])])} />
            <input
              ref={noteInput}
              type="file"
              accept={NOTE_FILES}
              multiple
              hidden
              onChange={(e) => setNoteFiles([...(e.target.files ?? [])].slice(0, 10))}
            />

            <div className="mt-5">
              {phase.step === "working" && <Working label={phase.label} />}

              {phase.step === "done" && (
                <div className="flex flex-col items-center gap-4 py-4 text-center" role="status">
                  <CheckCircle2 aria-hidden className="h-14 w-14 text-emerald-300" strokeWidth={2.5} />
                  <p className="text-lg font-semibold leading-snug">{phase.message}</p>
                  {phase.needsTocFor !== undefined ? (
                    <GlossyButton
                      variant="blue"
                      size="lg"
                      icon={<Camera className="h-5 w-5" strokeWidth={2.5} />}
                      onClick={() => {
                        tocTitle.current = phase.needsTocFor ?? null;
                        openPhotos("toc");
                      }}
                    >
                      Snap the table of contents
                    </GlossyButton>
                  ) : (
                    <GlossyButton variant="emerald" size="lg" onClick={onClose}>
                      Done
                    </GlossyButton>
                  )}
                  <button type="button" className="min-h-11 px-4 text-sm font-semibold text-white/60 underline-offset-4 hover:underline" onClick={() => setPhase({ step: "choose" })}>
                    Add something else
                  </button>
                </div>
              )}

              {phase.step === "error" && (
                <div className="flex flex-col items-center gap-4 py-4 text-center" role="alert">
                  <p className="text-lg font-semibold leading-snug text-rose-200">{phase.message}</p>
                  <GlossyButton variant="glass" size="lg" onClick={() => setPhase({ step: "choose" })}>
                    Try again
                  </GlossyButton>
                </div>
              )}

              {phase.step === "photo-source" && (
                <div className="flex flex-col gap-3">
                  <BigChoice
                    Icon={Camera}
                    tint="from-sky-400/30 to-blue-600/20 text-sky-200"
                    title="Take a photo"
                    hint={phase.target === "toc" ? "One page. For more pages, choose them from your photos." : "A book page, a cover, or your screen"}
                    onClick={() => void fromPhone(phase.target, "camera")}
                  />
                  <BigChoice
                    Icon={Images}
                    tint="from-violet-400/30 to-violet-600/20 text-violet-200"
                    title="Choose from photos"
                    hint="Screenshots live here. Pick up to 10."
                    onClick={() => void fromPhone(phase.target, "gallery")}
                  />
                </div>
              )}

              {phase.step === "choose" && mode === "home" && (
                <div className="flex flex-col gap-3">
                  <form
                    role="search"
                    className="relative"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (searchText.trim().length < 2) return;
                      setSearchQuery(searchText.trim());
                      setMode("search");
                    }}
                  >
                    <label htmlFor="magic-search" className="sr-only">
                      Search your notes, books and questions
                    </label>
                    <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/50" strokeWidth={2.5} />
                    <input
                      id="magic-search"
                      type="search"
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      enterKeyHint="search"
                      maxLength={120}
                      placeholder="Search notes, books, questions"
                      className="min-h-12 w-full rounded-2xl border border-white/15 bg-white/[0.06] pl-11 pr-4 text-base text-white placeholder:text-white/45 focus:border-sky-300/60 focus:outline-none"
                    />
                  </form>
                  <BigChoice
                    Icon={Camera}
                    tint="from-sky-400/30 to-blue-600/20 text-sky-200"
                    title="Snap Photo / Screenshot"
                    hint="A table of contents, a book cover, or a UWorld question"
                    onClick={() => openPhotos("magic")}
                  />
                  <BigChoice
                    Icon={ClipboardPaste}
                    tint="from-violet-400/30 to-violet-600/20 text-violet-200"
                    title="Paste Note / Question"
                    hint="NotebookLM notes, a study guide, or a question and its rationale"
                    onClick={() => setMode("paste")}
                  />
                  <BigChoice
                    Icon={BookPlus}
                    tint="from-emerald-300/30 to-emerald-600/20 text-emerald-200"
                    title="Add School Book"
                    hint="Type the title or ISBN"
                    onClick={() => setMode("book")}
                  />
                  <BigChoice
                    Icon={FileText}
                    tint="from-teal-300/30 to-teal-600/20 text-teal-100"
                    title="Add a Whole Book (PDF)"
                    hint="Your school book's PDF, so lessons use its real pages"
                    onClick={() => setMode("pdf")}
                  />
                  <button
                    type="button"
                    onClick={() => setMode("sync")}
                    className="mx-auto mt-1 flex min-h-11 items-center gap-2 px-3 text-sm font-semibold text-white/60 hover:text-white"
                  >
                    <FolderSync aria-hidden className="h-4 w-4" strokeWidth={2.5} />
                    Sync a NotebookLM folder
                  </button>
                </div>
              )}

              {phase.step === "choose" && mode === "paste" && (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendPaste();
                  }}
                >
                  <label htmlFor="magic-paste" className="sr-only">
                    Note or question
                  </label>
                  <textarea
                    id="magic-paste"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    autoFocus
                    rows={7}
                    placeholder="Paste here..."
                    className="w-full resize-none rounded-2xl border border-white/15 bg-white/[0.06] p-4 text-base text-white placeholder:text-white/40 focus:border-sky-300/60 focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-2">
                    <GlossyButton onClick={pasteFromClipboard} icon={<ClipboardPaste className="h-5 w-5" strokeWidth={2.5} />}>
                      Paste
                    </GlossyButton>
                    <GlossyButton
                      onClick={() => {
                        if (noteInput.current) noteInput.current.value = "";
                        noteInput.current?.click();
                      }}
                      icon={<Paperclip className="h-5 w-5" strokeWidth={2.5} />}
                    >
                      Attach a file
                    </GlossyButton>
                  </div>
                  {noteFiles.length > 0 && (
                    <ul className="flex flex-col gap-1 text-sm text-white/70" aria-label="Attached files">
                      {noteFiles.map((f) => (
                        <li key={f.name} className="truncate">
                          📄 {f.name}
                        </li>
                      ))}
                    </ul>
                  )}
                  <NotebookPicker value={notebook} onChange={setNotebook} />
                  <GlossyButton type="submit" variant="violet" size="lg" className="justify-center" disabled={!text.trim() && noteFiles.length === 0}>
                    Add it
                  </GlossyButton>
                </form>
              )}

              {phase.step === "choose" && mode === "book" && (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendBook();
                  }}
                >
                  <label htmlFor="magic-book" className="text-sm font-semibold text-white/70">
                    Book title or ISBN
                  </label>
                  <input
                    id="magic-book"
                    value={bookText}
                    onChange={(e) => setBookText(e.target.value)}
                    autoFocus
                    autoComplete="off"
                    enterKeyHint="go"
                    placeholder="Foundations of Nursing, 9th edition"
                    className="min-h-14 w-full rounded-2xl border border-white/15 bg-white/[0.06] px-4 text-base text-white placeholder:text-white/40 focus:border-emerald-300/60 focus:outline-none"
                  />
                  <GlossyButton type="submit" variant="emerald" size="lg" className="justify-center" disabled={!bookText.trim()}>
                    Build my path
                  </GlossyButton>
                  <p className="text-center text-sm text-white/50">No luck finding it? Snap its table of contents instead.</p>
                </form>
              )}

              {phase.step === "choose" && mode === "sync" && <NotebookSyncPanel onAccountChanged={onAccountChanged} />}
              {phase.step === "choose" && mode === "pdf" && <TextbookPdfPanel onAdded={onAdded} onAddBook={() => setMode("book")} onDone={onClose} />}
              {phase.step === "choose" && mode === "search" && (
                <SearchPanel
                  initialQuery={searchQuery}
                  onOpenStone={(stone) => {
                    onClose();
                    onOpenStone(stone);
                  }}
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function BigChoice({ Icon, tint, title, hint, onClick }: { Icon: typeof Camera; tint: string; title: string; hint: string; onClick: () => void }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={reduceMotion ? undefined : { scale: 0.97 }}
      className={cn(
        "flex min-h-20 w-full items-center gap-4 rounded-3xl p-4 text-left",
        GLASS_SURFACE,
        "shadow-[inset_0_1px_1px_rgba(255,255,255,0.35)] focus-visible:outline-2 focus-visible:outline-sky-300",
      )}
    >
      <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b", tint)}>
        <Icon aria-hidden className="h-7 w-7" strokeWidth={2.5} />
      </span>
      <span className="flex flex-col">
        <span className="text-lg font-bold">{title}</span>
        <span className="text-sm leading-snug text-white/60">{hint}</span>
      </span>
    </motion.button>
  );
}

function Working({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center" role="status" aria-live="polite">
      <Loader2 aria-hidden className="h-12 w-12 animate-spin text-sky-300" strokeWidth={2.5} />
      <p className="text-lg font-semibold">{label}</p>
      <p className="text-sm text-white/50">Big books and long notes can take a minute.</p>
    </div>
  );
}
