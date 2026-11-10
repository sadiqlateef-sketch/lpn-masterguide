"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { GlossyButton } from "@/components/glass/GlossyButton";
import { cn } from "@/lib/cn";

// The full-screen sheet every practice screen opens in: a title row with a close button over a
// scrolling column, the same frame as a review.
export function FullSheet({
  open,
  title,
  icon,
  tone = "text-sky-200",
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  icon: React.ReactNode;
  tone?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-[60] flex flex-col bg-canvas/95 px-4 pb-[max(1.5rem,var(--safe-bottom))] pt-[max(1rem,var(--safe-top))] backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
            <p className={cn("flex min-w-0 items-center gap-2 text-sm font-bold uppercase tracking-wide", tone)}>
              <span aria-hidden className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">
                {icon}
              </span>
              <span className="truncate">{title}</span>
            </p>
            <GlossyButton size="icon" onClick={onClose} aria-label={`Close ${title}`} icon={<X className="h-6 w-6" strokeWidth={2.5} />} />
          </div>
          <div className="mx-auto mt-4 flex w-full max-w-md flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pb-4">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Busy({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center" role="status" aria-live="polite">
      <Loader2 aria-hidden className="h-10 w-10 animate-spin text-sky-200" strokeWidth={2.5} />
      <p className="font-semibold">{label}</p>
    </div>
  );
}

export function Problem({ message, onRetry, onClose }: { message: string; onRetry?: () => void; onClose?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center" role="alert">
      <p className="text-lg font-semibold">{message}</p>
      <div className="flex gap-3">
        {onRetry && (
          <GlossyButton variant="amber" onClick={onRetry}>
            Try again
          </GlossyButton>
        )}
        {onClose && <GlossyButton onClick={onClose}>Close</GlossyButton>}
      </div>
    </div>
  );
}

export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
