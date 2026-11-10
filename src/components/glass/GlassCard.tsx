"use client";

import { forwardRef } from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/cn";

export type GlowColor = "none" | "cyan" | "blue" | "amber" | "violet" | "emerald" | "ruby";

export const GLOW_CLASSES: Record<GlowColor, string> = {
  none: "",
  cyan: "shadow-[0_0_40px_-8px_rgba(34,211,238,0.55)]",
  blue: "shadow-[0_0_40px_-8px_rgba(56,189,248,0.55)]",
  amber: "shadow-[0_0_40px_-8px_rgba(251,191,36,0.55)]",
  violet: "shadow-[0_0_40px_-8px_rgba(167,139,250,0.55)]",
  emerald: "shadow-[0_0_40px_-8px_rgba(52,211,153,0.55)]",
  ruby: "shadow-[0_0_40px_-8px_rgba(244,63,94,0.6)]",
};

export const GLASS_SURFACE =
  "backdrop-blur-2xl bg-white/[0.07] border border-t-white/25 border-l-white/20 border-b-white/5 border-r-white/5";

const INNER_HIGHLIGHT = "shadow-[inset_0_1px_1px_rgba(255,255,255,0.35)]";

type GlassCardProps = HTMLMotionProps<"div"> & {
  glow?: GlowColor;
  interactive?: boolean;
};

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(function GlassCard(
  { glow = "none", interactive = false, className, children, ...props },
  ref,
) {
  const reduceMotion = useReducedMotion();
  const springy = interactive && !reduceMotion;

  return (
    <motion.div
      ref={ref}
      initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={springy ? { y: -3, scale: 1.01 } : undefined}
      whileTap={springy ? { scale: 0.98 } : undefined}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      className={cn("relative rounded-3xl p-5 text-white", GLASS_SURFACE, GLOW_CLASSES[glow], className)}
      {...props}
    >
      <span aria-hidden className={cn("pointer-events-none absolute inset-0 rounded-[inherit]", INNER_HIGHLIGHT)} />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent"
      />
      <div className="relative">{children as React.ReactNode}</div>
    </motion.div>
  );
});
