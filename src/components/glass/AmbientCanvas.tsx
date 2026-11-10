"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

type Orb = {
  className: string;
  x: [number, number, number];
  y: [number, number, number];
  duration: number;
};

const ORBS: Orb[] = [
  { className: "left-[-10%] top-[-10%] h-[55vmax] w-[55vmax] bg-sky-500/30", x: [0, 60, 0], y: [0, 40, 0], duration: 22 },
  { className: "right-[-15%] top-[20%] h-[45vmax] w-[45vmax] bg-violet-500/25", x: [0, -50, 0], y: [0, 60, 0], duration: 26 },
  { className: "bottom-[-20%] left-[15%] h-[50vmax] w-[50vmax] bg-emerald-400/20", x: [0, 40, 0], y: [0, -50, 0], duration: 30 },
  { className: "bottom-[10%] right-[5%] h-[30vmax] w-[30vmax] bg-cyan-400/20", x: [0, -30, 0], y: [0, -30, 0], duration: 18 },
];

type AmbientCanvasProps = {
  children: React.ReactNode;
  className?: string;
};

export function AmbientCanvas({ children, className }: AmbientCanvasProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div className={cn("relative min-h-dvh overflow-hidden bg-[#020617]", className)}>
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        {ORBS.map((orb, i) => (
          <motion.div
            key={i}
            className={cn("absolute rounded-full blur-[110px]", orb.className)}
            animate={reduceMotion ? undefined : { x: orb.x, y: orb.y }}
            transition={{ duration: orb.duration, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06),transparent_60%)]" />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
