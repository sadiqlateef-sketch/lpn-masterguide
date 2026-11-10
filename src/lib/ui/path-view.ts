import type { PathCourse, PathModule, PathStone, PathView } from "@/lib/api-types";

// Pure helpers for the Path screen, kept apart from the component so they can be tested.

export function courseStones(course: PathCourse): PathStone[] {
  return course.books.flatMap((b) => b.units.flatMap((u) => u.modules.flatMap((m) => m.stones)));
}

export type CourseStats = { total: number; mastered: number; locked: number };

export function courseStats(course: PathCourse): CourseStats {
  const stones = courseStones(course);
  return {
    total: stones.length,
    mastered: stones.filter((s) => s.status === "mastered").length,
    locked: stones.filter((s) => s.status === "locked").length,
  };
}

// The course to show first: the one holding the next stone, else the first course.
export function courseOfStone(path: PathView, stoneId: string | null): string | null {
  if (!stoneId) return path.courses[0]?.id ?? null;
  const course = path.courses.find((c) => courseStones(c).some((s) => s.id === stoneId));
  return course?.id ?? path.courses[0]?.id ?? null;
}

export function findStone(path: PathView, stoneId: string | null): PathStone | null {
  if (!stoneId) return null;
  for (const course of path.courses) {
    const stone = courseStones(course).find((s) => s.id === stoneId);
    if (stone) return stone;
  }
  return null;
}

export type ChapterEntry = { module: PathModule; bookTitle: string; mastered: number; total: number; hasNext: boolean };

export function courseChapters(course: PathCourse, nextStoneId: string | null): ChapterEntry[] {
  return course.books.flatMap((book) =>
    book.units.flatMap((unit) =>
      unit.modules.map((module) => ({
        module,
        bookTitle: book.title,
        mastered: module.stones.filter((s) => s.status === "mastered").length,
        total: module.stones.length,
        hasNext: module.stones.some((s) => s.id === nextStoneId),
      })),
    ),
  );
}

// Swiping across the path changes course. Returns the course id to move to, or null at either end.
export function neighborCourse(courses: readonly { id: string }[], currentId: string | null, step: 1 | -1): string | null {
  const index = courses.findIndex((c) => c.id === currentId);
  if (index < 0) return null;
  return courses[index + step]?.id ?? null;
}

export type Point = { x: number; y: number };

// A smooth line through the stone centers: each hop is a gentle S-curve, so the zigzag reads as one trail.
export function connectorPath(points: readonly Point[]): string {
  if (points.length < 2) return "";
  const r = (n: number) => Math.round(n * 10) / 10;
  let d = `M ${r(points[0].x)} ${r(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const midY = (a.y + b.y) / 2;
    d += ` C ${r(a.x)} ${r(midY)}, ${r(b.x)} ${r(midY)}, ${r(b.x)} ${r(b.y)}`;
  }
  return d;
}
