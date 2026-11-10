"use client";

import { forwardRef } from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/cn";

type Variant = "glass" | "blue" | "emerald" | "ruby" | "amber" | "violet";
type Size = "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  glass: "bg-white/[0.08] text-white",
  blue: "bg-gradient-to-b from-sky-400/90 to-blue-600/90 text-snow shadow-[0_8px_30px_-6px_rgba(56,189,248,0.6)]",
  emerald: "bg-gradient-to-b from-emerald-300/90 to-emerald-600/90 text-snow shadow-[0_8px_30px_-6px_rgba(52,211,153,0.6)]",
  ruby: "bg-gradient-to-b from-rose-400/90 to-rose-600/90 text-snow shadow-[0_8px_30px_-6px_rgba(244,63,94,0.6)]",
  amber: "bg-gradient-to-b from-amber-300/90 to-amber-500/90 text-on-accent shadow-[0_8px_30px_-6px_rgba(251,191,36,0.6)]",
  violet: "bg-gradient-to-b from-violet-400/90 to-violet-600/90 text-snow shadow-[0_8px_30px_-6px_rgba(167,139,250,0.6)]",
};

const SIZES: Record<Size, string> = {
  md: "min-h-11 px-5 text-sm gap-2",
  lg: "min-h-14 px-7 text-base gap-3",
  icon: "h-12 w-12 justify-center",
};

type GlossyButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  children?: React.ReactNode;
};

export const GlossyButton = forwardRef<HTMLButtonElement, GlossyButtonProps>(function GlossyButton(
  { variant = "glass", size = "md", icon, className, children, type = "button", disabled, ...props },
  ref,
) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={disabled}
      whileHover={reduceMotion || disabled ? undefined : { scale: 1.03 }}
      whileTap={reduceMotion || disabled ? undefined : { scale: 0.95 }}
      transition={{ type: "spring", stiffness: 500, damping: 22 }}
      className={cn(
        "relative inline-flex select-none items-center overflow-hidden rounded-full font-semibold backdrop-blur-xl",
        "border border-t-snow/40 border-l-snow/25 border-b-snow/5 border-r-snow/5",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-snow/35 to-transparent"
      />
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_1px_1px_rgba(255,255,255,0.45)]" />
      {icon && <span className="relative flex shrink-0 items-center">{icon}</span>}
      {children && <span className="relative">{children}</span>}
    </motion.button>
  );
});
