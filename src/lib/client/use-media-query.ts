"use client";

import { useSyncExternalStore } from "react";

// True while the media query matches. Server render and the first paint assume false.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

// The unfolded Galaxy Z Fold inner screen and tablets: path on the left, lesson on the right.
export const TWO_PANE_QUERY = "(min-width: 700px)";
