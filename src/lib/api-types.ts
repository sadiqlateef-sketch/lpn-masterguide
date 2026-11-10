// Shapes the API routes return and the screens read. Shared by server and client code.

export type StoneStatus = "locked" | "ready" | "mastered" | "needs_review";

export type PathStone = {
  id: string;
  title: string;
  summary: string | null;
  status: StoneStatus;
  mastery: number;
};

export type PathModule = { id: string; title: string; chapterNumber: string | null; stones: PathStone[] };
export type PathUnit = { id: string; title: string; modules: PathModule[] };
export type PathBook = { id: string; title: string; edition: string | null; coverUrl: string | null; units: PathUnit[] };
export type PathCourse = { id: string; name: string; books: PathBook[] };

export type PathView = {
  courses: PathCourse[];
  counts: { stones: number; ready: number; mastered: number; needsReview: number };
  // The stone the student should open next: the first one needing review, else the first ready one.
  nextStoneId: string | null;
};

export type LessonCardKind = "eli10" | "lpn_core" | "exam_alert" | "notebooklm" | "quick_play";

export type LessonCardView = {
  id: string;
  kind: LessonCardKind;
  title: string;
  body?: string;
  bullets?: string[];
};

export type ChoiceView = { id: string; text: string };

export type PracticeOrigin = "lesson" | "uworld_twin";

// Practice items are sent without their answers; grading happens on the server.
export type PracticeView =
  | { id: string; type: "mcq" | "sata"; origin: PracticeOrigin; stem: string; options: ChoiceView[] }
  | {
      id: string;
      type: "bowtie";
      origin: PracticeOrigin;
      scenario: string;
      condition: { prompt: string; options: ChoiceView[]; pick: 1 };
      actions: { prompt: string; options: ChoiceView[]; pick: number };
      parameters: { prompt: string; options: ChoiceView[]; pick: number };
    };

export type LessonView = {
  stoneId: string;
  stoneTitle: string;
  cached: boolean;
  cards: LessonCardView[];
  practice: PracticeView[];
};

export type BowtieAnswer = { condition: string; actions: string[]; parameters: string[] };

export type AttemptRequest = { itemId: string; selected?: string[]; bowtie?: BowtieAnswer };

export type GradeResult = {
  attemptId: string;
  correct: boolean;
  score: number;
  rationale: string;
  scopeNote: string | null;
  // For multiple choice: the right option ids. For a bowtie: the right ids per section.
  correctOptionIds?: string[];
  bowtie?: BowtieAnswer;
};

export type CompleteResult = {
  status: StoneStatus;
  mastered: boolean;
  score: number;
  answered: number;
  unlockedStone: { id: string; title: string } | null;
};

export type ReadinessCategory = {
  id: string;
  name: string;
  weightPct: number;
  attempts: number;
  correct: number;
  accuracy: number | null;
  // 0 to 1: how ready this area looks, counting both accuracy and how much has been practiced.
  readiness: number;
  reviewStones: { id: string; title: string; status: StoneStatus }[];
};

export type ReadinessView = {
  nclexReadiness: number;
  hesi: { projected: number; band: { id: string; label: string; meaning: string } } | null;
  questionsToUnlockHesi: number;
  totalAttempts: number;
  categories: ReadinessCategory[];
  weakCategoryIds: string[];
  path: { stones: number; mastered: number };
  // Share of questions right per week, oldest first, ending with the current week.
  trend: TrendWeek[];
};

// weekStart is the Monday (UTC) the week starts on, as YYYY-MM-DD. accuracy is null for a week with no answers.
export type TrendWeek = { weekStart: string; attempts: number; correct: number; accuracy: number | null };

export type NoteSourceView = {
  id: string;
  title: string;
  externalKey: string | null;
  contentHash: string | null;
  chunks: number;
  createdAt: string;
};

export type ApiErrorBody = { error: { code: string; message: string } };
