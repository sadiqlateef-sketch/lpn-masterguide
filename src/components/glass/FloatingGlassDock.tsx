"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Gauge, Map, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { GLASS_SURFACE } from "./GlassCard";

export type DockTab = "path" | "readiness";

type FloatingGlassDockProps = {
  active: DockTab;
  onTabChange: (tab: DockTab) => void;
  onMagicAdd: () => void;
  className?: string;
  inert?: boolean;
  style?: React.CSSProperties;
};

const TABS: { id: DockTab; label: string; Icon: typeof Map }[] = [
  { id: "path", label: "Path", Icon: Map },
  { id: "readiness", label: "Readiness", Icon: Gauge },
];

export function FloatingGlassDock({ active, onTabChange, onMagicAdd, className, inert, style }: FloatingGlassDockProps) {
  const reduceMotion = useReducedMotion();
  const [pathTab, readinessTab] = TABS;

  const renderTab = ({ id, label, Icon }: (typeof TABS)[number]) => {
    const isActive = active === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onTabChange(id)}
        aria-current={isActive ? "page" : undefined}
        className="relative flex min-h-14 min-w-20 flex-col px-3 items-center justify-center gap-1 rounded-full text-xs font-semibold focus-visible:outline-2 focus-visible:outline-sky-300"
      >
        {isActive && (
          <motion.span
            layoutId="dock-active"
            className="absolute inset-0 rounded-full bg-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]"
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
          />
        )}
        <Icon aria-hidden className={cn("relative h-6 w-6", isActive ? "text-sky-300" : "text-white/70")} strokeWidth={2.5} />
        <span className={cn("relative", isActive ? "text-white" : "text-white/60")}>{label}</span>
      </button>
    );
  };

  return (
    <nav
      aria-label="Main"
      inert={inert}
      style={style}
      className={cn(
        "fixed inset-x-0 bottom-[calc(1rem+var(--safe-bottom))] z-50 mx-auto flex w-fit items-center gap-3 rounded-full px-3 py-2",
        GLASS_SURFACE,
        // Darker than other glass so the page scrolling underneath never fights with the labels.
        "bg-dock",
        "shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.35)]",
        className,
      )}
    >
      {renderTab(pathTab)}
      <motion.button
        type="button"
        onClick={onMagicAdd}
        aria-label="Magic add"
        whileTap={reduceMotion ? undefined : { scale: 0.9, rotate: 90 }}
        whileHover={reduceMotion ? undefined : { scale: 1.06 }}
        transition={{ type: "spring", stiffness: 500, damping: 20 }}
        className={cn(
          "relative -my-5 flex h-16 w-16 items-center justify-center rounded-full",
          "bg-gradient-to-br from-sky-400 via-violet-500 to-emerald-400 text-snow",
          "border border-t-snow/50 border-l-snow/30 border-b-snow/5 border-r-snow/5",
          "shadow-[0_10px_40px_-6px_rgba(56,189,248,0.8),inset_0_1px_2px_rgba(255,255,255,0.6)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300",
        )}
      >
        <span aria-hidden className="pointer-events-none absolute inset-x-2 top-1 h-1/2 rounded-full bg-gradient-to-b from-snow/45 to-transparent" />
        <Plus aria-hidden className="relative h-8 w-8" strokeWidth={3} />
      </motion.button>
      {renderTab(readinessTab)}
    </nav>
  );
}
