// Shapes the API routes return and the screens read. Shared by server and client code.

export type StoneStatus = "locked" | "ready" | "mastered" | "needs_review";

export type PathStone = {
  id: string;
  title: string;
  summary: string | null;
  status: StoneStatus;
  mastery: number;
  // Mastered, and its spaced review is due today or earlier.
  dueForReview?: boolean;
};

export type PathModule = { id: string; title: string; chapterNumber: string | null; stones: PathStone[] };
export type PathUnit = { id: string; title: string; modules: PathModule[] };
export type PathBook = { id: string; title: string; edition: string | null; coverUrl: string | null; units: PathUnit[] };
export type PathCourse = { id: string; name: string; books: PathBook[] };

export type PathView = {
  courses: PathCourse[];
  counts: { stones: number; ready: number; mastered: number; needsReview: number; dueForReview?: number };
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
  // Where the card's facts came from, e.g. "From Pharm notebook: Cardiac notes" or "Foundations, pp. 45-49".
  caption?: string;
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
    }
  // NGN matrix: pick one column for each row.
  | { id: string; type: "matrix"; origin: PracticeOrigin; stem: string; columns: ChoiceView[]; rows: ChoiceView[] }
  // NGN drop-down cloze: `text` holds {{blankId}} markers, one drop-down per blank.
  | { id: string; type: "cloze"; origin: PracticeOrigin; stem: string; text: string; blanks: { id: string; options: ChoiceView[] }[] }
  // NGN highlight: tap the parts of the passage that answer the stem.
  | { id: string; type: "highlight"; origin: PracticeOrigin; stem: string; segments: ChoiceView[] }
  // NGN ordered response: put every step in order.
  | { id: string; type: "ordered"; origin: PracticeOrigin; stem: string; items: ChoiceView[] };

export type PracticeType = PracticeView["type"];

export type LessonView = {
  stoneId: string;
  stoneTitle: string;
  cached: boolean;
  cards: LessonCardView[];
  practice: PracticeView[];
};

export type BowtieAnswer = { condition: string; actions: string[]; parameters: string[] };

export type AttemptRequest = {
  itemId: string;
  // Multiple choice, select-all and highlight.
  selected?: string[];
  bowtie?: BowtieAnswer;
  // Matrix: row id to column id. Cloze: blank id to option id.
  matrix?: Record<string, string>;
  cloze?: Record<string, string>;
  // Ordered response: every item id, first to last.
  order?: string[];
};

export type OptionRationale = { id: string; why: string };

export type GradeResult = {
  attemptId: string;
  correct: boolean;
  score: number;
  rationale: string;
  scopeNote: string | null;
  // For multiple choice: the right option ids. For a bowtie: the right ids per section.
  correctOptionIds?: string[];
  bowtie?: BowtieAnswer;
  matrix?: Record<string, string>;
  cloze?: Record<string, string>;
  order?: string[];
  // Why each option is right or wrong, when the question has them.
  optionRationales?: OptionRationale[];
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
  notebookId: string | null;
  externalKey: string | null;
  contentHash: string | null;
  chunks: number;
  createdAt: string;
};

export const NOTEBOOK_COLORS = ["violet", "sky", "emerald", "amber", "rose", "cyan"] as const;
export type NotebookColor = (typeof NOTEBOOK_COLORS)[number];

export type NotebookView = { id: string; name: string; color: NotebookColor; sources: number; createdAt: string };

// ---------------------------------------------------------------------------
// Whole textbook PDFs
// ---------------------------------------------------------------------------

export type TextbookPartState = "uploaded" | "processing" | "done" | "no_text" | "failed";

export type TextbookPartView = { part: number; state: TextbookPartState; pages: number | null; chunks: number; error: string | null };

export type TextbookView = {
  id: string;
  title: string;
  courseId: string;
  stones: number;
  pdf: { parts: number | null; uploaded: TextbookPartView[]; passages: number; passagesLinked: number } | null;
};

export type ProcessPartResult = {
  part: TextbookPartView;
  passagesLinked: number;
  stonesLinked: number;
  // True once every part of the book has been read.
  complete: boolean;
  message: string;
};

// ---------------------------------------------------------------------------
// Course plans
// ---------------------------------------------------------------------------

export type PlanCoverage = "full" | "partial" | "outline_only";

export type PlanSourceRefs = {
  textbookPages: { book: string; pages: string }[];
  notebooks: { name: string; notes: number }[];
  questions: number;
};

export type PlanWeekView = {
  week: number;
  title: string;
  goals: string[];
  stones: { id: string; title: string; status: StoneStatus }[];
  sources: PlanSourceRefs;
  coverage: PlanCoverage;
  // NCLEX-style questions that close the week, drawn from its stones' lessons.
  checkpoint: PracticeView[];
};

export type CoursePlanView = {
  courseId: string;
  version: number;
  createdAt: string;
  summary: string;
  weeks: PlanWeekView[];
  // The student added or removed a source since this plan was drafted.
  stale: boolean;
  sourceCounts: { textbookPassages: number; notes: number; questions: number };
};

// ---------------------------------------------------------------------------
// Ask about this card, and search
// ---------------------------------------------------------------------------

export type AskSource = { kind: "note" | "textbook"; label: string };

export type AskAnswer = { id: string; answer: string; inScope: boolean; sources: AskSource[] };

export type SearchResultKind = "stone" | "note" | "textbook" | "question";

export type SearchResult = {
  kind: SearchResultKind;
  id: string;
  stone: { id: string; title: string; status: StoneStatus } | null;
  title: string;
  snippet: string;
};

// ---------------------------------------------------------------------------
// Study planner, spaced review, streaks and the weekly report
// ---------------------------------------------------------------------------

export type StudyProfileView = {
  nclexDate: string | null;
  hesiDate: string | null;
  // "HH:MM", in the student's time zone.
  reminderTime: string | null;
  timezone: string;
  reviewBufferDays: number;
};

// weekday is ISO: 1 is Monday, 7 is Sunday. start is "HH:MM". A null course goes to whichever course is furthest behind.
export type StudyBlockView = { id?: string; weekday: number; start: string; minutes: number; courseId: string | null };

export type ReviewGrade = "again" | "hard" | "good" | "easy";

export type PaceStatus = "no_exam" | "on_track" | "tight" | "behind" | "done";

export type PaceView = {
  exam: { kind: "nclex" | "hesi"; date: string; daysLeft: number } | null;
  // Last day for new stones, before the review-only buffer.
  learnBy: string | null;
  studyDaysLeft: number;
  remainingStones: number;
  stonesPerStudyDay: number;
  capacityPerStudyDay: number;
  status: PaceStatus;
};

export type StreakView = { current: number; best: number; activeToday: boolean };

export type TodayStone = { id: string; title: string; courseId: string; status: StoneStatus };

export type TodayView = {
  day: string;
  weekday: number;
  blocks: { start: string; minutes: number; courseId: string; courseName: string }[];
  plannedMinutes: number;
  reviews: (TodayStone & { dueOn: string; overdueDays: number })[];
  reviewsDueTotal: number;
  learn: TodayStone[];
  learnGoal: number;
  questionsGoal: number;
  done: { minutes: number; stones: number; questions: number; reviews: number };
  streak: StreakView;
  pace: PaceView;
  reminderTime: string | null;
  // False until the student saves exam dates or study times.
  hasSetup: boolean;
};

export type ReviewResult = {
  grade: ReviewGrade;
  correct: number;
  answered: number;
  intervalDays: number;
  dueOn: string;
  status: StoneStatus;
};

export type WeeklyReportView = {
  weekStart: string;
  weekEnd: string;
  complete: boolean;
  minutesStudied: number;
  minutesPlanned: number;
  daysStudied: number;
  questions: number;
  accuracy: number | null;
  // Change in the share of questions right against the week before, when both weeks have answers.
  accuracyChange: number | null;
  reviews: number;
  mastered: { id: string; title: string }[];
  slipped: { id: string; title: string }[];
  nextFocus: string[];
};

// ---------------------------------------------------------------------------
// Anki decks (stage 5)
// ---------------------------------------------------------------------------

export type DeckState = "importing" | "ready" | "failed";

export type DeckView = {
  id: string;
  name: string;
  fileName: string | null;
  state: DeckState;
  error: string | null;
  cards: number;
  skipped: number;
  filed: number;
  checked: number;
  checkCap: number;
  checksUsed: number;
  flagsPending: number;
  suggestionsPending: number;
  createdAt: string;
};

export type CardVerdict = "agrees" | "disagrees" | "outdated" | "out_of_scope" | "no_source";
export type CheckDecision = "none" | "pending" | "accepted" | "dismissed";

export type SourceQuote = { kind: "note" | "textbook"; label: string; quote: string };

export type CardCheckView = {
  id: string;
  cardId: string;
  front: string;
  back: string;
  stoneTitle: string | null;
  verdict: CardVerdict;
  explanation: string;
  suggestion: { front: string; back: string } | { action: "suspend" } | null;
  sources: SourceQuote[];
  escalated: boolean;
  decision: CheckDecision;
};

export type CardSuggestionView = {
  id: string;
  stoneId: string;
  stoneTitle: string;
  front: string;
  back: string;
  sources: SourceQuote[];
};

export type DeckCheckProgress = {
  deck: DeckView;
  checkedNow: number;
  remaining: number;
  capReached: boolean;
};

export type DeckCardView = { id: string; front: string; back: string; origin: "import" | "suggested" };

export type ApiErrorBody = { error: { code: string; message: string } };

// ---------------------------------------------------------------------------
// Games, practice exams, drug cards and the mistake notebook (stage 6)
// ---------------------------------------------------------------------------

export const GAME_IDS = ["med_match", "lab_levels", "triage", "ppe_order", "med_math", "scope", "isolation"] as const;
export type GameId = (typeof GAME_IDS)[number];

export type GameSummary = {
  id: GameId;
  title: string;
  blurb: string;
  // Built from the student's own stones (needs studied stones), or from a fixed bank.
  fromStones: boolean;
  available: boolean;
  unavailableReason: string | null;
  played: number;
  bestPct: number | null;
  lastPct: number | null;
};

export type GameRoundView =
  | { kind: "match"; prompt: string; left: ChoiceView[]; right: ChoiceView[] }
  | { kind: "bins"; prompt: string; bins: ChoiceView[]; cards: ChoiceView[] }
  | { kind: "order"; prompt: string; items: ChoiceView[] }
  | { kind: "calc"; prompt: string; problems: { id: string; text: string; unit: string }[] };

export type GameRound = {
  roundId: string;
  game: GameId;
  title: string;
  stones: { id: string; title: string }[];
  // Seconds for a speed round, or null.
  timeLimitSeconds: number | null;
  view: GameRoundView;
};

// match: left id to right id. bins: card id to bin id. order: ids first to last. calc: problem id to the typed answer.
export type GameAnswer = { match?: Record<string, string>; bins?: Record<string, string>; order?: string[]; calc?: Record<string, string> };

export type GameItemResult = {
  id: string;
  label: string;
  correct: boolean;
  // What the right answer was, in words, and why.
  expected: string;
  given: string | null;
  why: string;
  steps?: string[];
};

export type GameResult = {
  roundId: string;
  correct: number;
  total: number;
  pct: number;
  bestPct: number | null;
  items: GameItemResult[];
  // NCLEX-style questions that close the round.
  ending: PracticeView[];
};

export type ExamItemView = { examId: string; position: number; item: PracticeView };

export type ExamStopReason = "confident_above" | "confident_below" | "max_items" | "time" | "out_of_items" | "ended";

export type ExamSummary = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  minItems: number;
  maxItems: number;
  timeLimitMinutes: number;
  answered: number;
  correct: number;
  ability: number;
  standardError: number;
  stopReason: ExamStopReason | null;
  // Plain-words reading of the estimate, with the caveat that it's practice.
  verdict: string;
  byClientNeed: { id: string; name: string; answered: number; correct: number }[];
};

export type ExamState = { summary: ExamSummary; current: ExamItemView | null };

export type ExamAnswerResult = { grade: GradeResult; state: ExamState };

export type DrugCardField = { text: string; fromSources: boolean };

export type DrugCardView = {
  id: string;
  name: string;
  createdAt: string;
  drugClass: DrugCardField;
  action: DrugCardField;
  uses: DrugCardField;
  sideEffects: DrugCardField;
  nursing: DrugCardField;
  teaching: DrugCardField;
  holdParameters: DrugCardField | null;
  sources: SourceQuote[];
  stone: { id: string; title: string } | null;
  questions: PracticeView[];
};

export type MistakeView = {
  item: PracticeView;
  stoneTitle: string | null;
  topic: string | null;
  missedAt: string;
  misses: number;
  note: string;
};

// ---------------------------------------------------------------------------
// Stage 6b: skills checklists, clinical day prep, care plans and share links
// ---------------------------------------------------------------------------

export type SkillConfidence = "not_yet" | "with_help" | "on_my_own";

export type SkillCheckView = {
  id: string;
  stepsDone: number;
  stepsTotal: number;
  // Step numbers (from 1) left unticked on that run.
  missedSteps: number[];
  confidence: SkillConfidence;
  checkedAt: string;
};

export type SkillSummary = {
  id: string;
  title: string;
  blurb: string;
  stepCount: number;
  runs: number;
  lastCheck: SkillCheckView | null;
  signedOffOn: string | null;
};

export type SkillStepView = { n: number; text: string; why: string; critical: boolean };

export type SkillView = {
  id: string;
  title: string;
  blurb: string;
  steps: SkillStepView[];
  history: SkillCheckView[];
  signedOffOn: string | null;
  questions: PracticeView[];
};

export type SkillRunResult = { check: SkillCheckView; missedCritical: SkillStepView[]; questions: PracticeView[] };

export type ClinicalInput = {
  title: string;
  clinicalOn: string | null;
  diagnoses: string[];
  medications: string[];
  skills: string[];
  focus: string;
};

export type ClinicalSheet = {
  conditions: { name: string; summary: string; watch: string[]; actions: string[]; report: string[]; fromSources: boolean }[];
  medications: { name: string; drugClass: string; why: string; checkFirst: string[]; watch: string[]; fromSources: boolean }[];
  skills: { name: string; points: string[] }[];
};

export type ClinicalPrepSummary = { id: string; title: string; clinicalOn: string | null; createdAt: string };

export type ClinicalPrepView = ClinicalPrepSummary & {
  input: ClinicalInput;
  sheet: ClinicalSheet;
  sources: SourceQuote[];
  questions: PracticeView[];
};

export type CarePlanProblem = {
  problem: string;
  relatedTo: string;
  evidence: string[];
  goal: string;
  interventions: { action: string; why: string }[];
  reportToRn: string[];
  evaluation: string;
};

export type CarePlanFeedback = {
  verdict: string;
  strengths: string[];
  fixes: { where: string; issue: string; better: string }[];
  scopeFlags: { text: string; why: string }[];
};

export type CarePlanSummary = { id: string; situation: string; problemCount: number; updatedAt: string };

export type CarePlanView = {
  id: string;
  prepId: string | null;
  situation: string;
  problems: CarePlanProblem[];
  feedback: CarePlanFeedback | null;
  questions: PracticeView[];
  createdAt: string;
  updatedAt: string;
};

export type ShareKind = "lesson" | "questions";

export type ShareLinkView = {
  id: string;
  token: string;
  kind: ShareKind;
  title: string;
  stoneId: string | null;
  itemCount: number;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

// What someone opening a share link sees: lesson cards with no notes or source captions, and
// questions without their answers (each one is checked on the server, and nothing is saved).
export type SharedDeckView = {
  kind: ShareKind;
  title: string;
  createdAt: string;
  expiresAt: string;
  cards: { kind: LessonCardKind; title: string; body?: string; bullets?: string[] }[];
  items: PracticeView[];
};

export type SharedGrade = Omit<GradeResult, "attemptId">;
