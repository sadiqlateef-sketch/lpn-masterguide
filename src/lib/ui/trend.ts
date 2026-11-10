import type { TrendWeek } from "@/lib/api-types";

export type TrendPoint = { x: number; y: number; week: TrendWeek };

// Places each week with answers on a chart of the given size (accuracy 0 at the bottom, 1 at the top).
// Weeks without answers leave a gap, so the line only joins weeks that were practiced.
export function trendPoints(trend: readonly TrendWeek[], width: number, height: number, pad = 8): TrendPoint[] {
  if (trend.length === 0) return [];
  const step = trend.length > 1 ? (width - pad * 2) / (trend.length - 1) : 0;
  return trend.flatMap((week, i) =>
    week.accuracy === null ? [] : [{ x: pad + i * step, y: pad + (1 - week.accuracy) * (height - pad * 2), week }],
  );
}

export function trendLine(points: readonly TrendPoint[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`).join(" ");
}

// Change from the first practiced week to the last, in whole percentage points, or null with fewer than two.
export function trendChange(trend: readonly TrendWeek[]): number | null {
  const practiced = trend.filter((w) => w.accuracy !== null);
  if (practiced.length < 2) return null;
  return Math.round(((practiced.at(-1)!.accuracy ?? 0) - (practiced[0].accuracy ?? 0)) * 100);
}
