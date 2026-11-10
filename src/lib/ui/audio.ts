import type { LessonView, PracticeView } from "@/lib/api-types";

// The audio playlist (F14): what gets read aloud for each lesson card, and the short set of
// NCLEX-style questions that ends the chapter.

export type AudioTrack = { stoneTitle: string; title: string; text: string };

export const MAX_PLAYLIST_QUESTIONS = 6;

// One track per card, skipping Quick Play (it's questions, not reading). A card reads its title,
// body and up to three bullets, the same three a story card shows.
export function lessonTracks(lesson: LessonView): AudioTrack[] {
  return lesson.cards
    .filter((c) => c.kind !== "quick_play")
    .map((c) => ({
      stoneTitle: lesson.stoneTitle,
      title: c.title,
      text: [c.title, c.body, ...(c.bullets ?? []).slice(0, 3)].filter(Boolean).join(". "),
    }));
}

// Two questions from each lesson, up to six, so the ending stays short.
export function playlistQuestions(lessons: readonly LessonView[]): PracticeView[] {
  return lessons.flatMap((l) => l.practice.slice(0, 2)).slice(0, MAX_PLAYLIST_QUESTIONS);
}
