import type {
  ApiErrorBody,
  AskAnswer,
  AttemptRequest,
  CardCheckView,
  CardSuggestionView,
  CardVerdict,
  DeckCardView,
  DeckCheckProgress,
  DeckView,
  CompleteResult,
  DrugCardView,
  ExamAnswerResult,
  ExamState,
  ExamSummary,
  GameAnswer,
  GameId,
  GameResult,
  GameRound,
  GameSummary,
  MistakeView,
  PracticeView,
  CoursePlanView,
  GradeResult,
  LessonView,
  NotebookColor,
  NotebookView,
  NoteSourceView,
  PathView,
  ProcessPartResult,
  ReadinessView,
  ReviewResult,
  SearchResult,
  StudyBlockView,
  StudyProfileView,
  TodayView,
  WeeklyReportView,
  TextbookPartView,
  TextbookView,
  CarePlanProblem,
  CarePlanSummary,
  CarePlanView,
  ClinicalInput,
  ClinicalPrepSummary,
  ClinicalPrepView,
  SharedDeckView,
  SharedGrade,
  ShareKind,
  ShareLinkView,
  SkillConfidence,
  SkillRunResult,
  SkillSummary,
  SkillView,
} from "@/lib/api-types";
import { cachedLesson, cachedPath, cacheLesson, cachePath, flushOutbox, type OutboxEntry } from "./offline";
import { ensureSession } from "./supabase";

export class ClientApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

// Empty on the web (same origin). The Android app's bundled screens call the hosted app instead.
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");

const OFFLINE_MESSAGE = "You seem to be offline. Check your connection and try again.";

function deviceOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let session;
  try {
    session = await ensureSession();
  } catch (error) {
    // A session that needs refreshing can't be refreshed offline: report that as offline, so saved lessons still open.
    if (deviceOffline()) throw new ClientApiError(OFFLINE_MESSAGE, "offline", 0);
    throw error;
  }
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${session.access_token}`);
  if (typeof init.body === "string") headers.set("content-type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ClientApiError("You seem to be offline. Check your connection and try again.", "offline", 0);
  }
  const body = (await response.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!response.ok) {
    throw new ClientApiError(body?.error?.message ?? "Something went wrong. Try again.", body?.error?.code ?? "error", response.status);
  }
  return body as T;
}

export function isOfflineError(error: unknown): boolean {
  return error instanceof ClientApiError && error.code === "offline";
}

// Loads from the server and keeps a copy on the phone; when offline, falls back to that copy.
async function withOfflineCopy<T>(load: () => Promise<T>, save: (value: T) => Promise<void>, saved: () => Promise<T | null>): Promise<T> {
  try {
    const value = await load();
    void save(value).catch(() => undefined);
    return value;
  } catch (error) {
    if (!isOfflineError(error)) throw error;
    const copy = await saved().catch(() => null);
    if (copy) return copy;
    throw error;
  }
}

export type BookResult =
  | { status: "created"; title: string; counts: { units: number; modules: number; stones: number } }
  | { status: "duplicate"; title: string }
  | { status: "needs_toc_photo"; book: { title: string } | null };

export type MagicAddResponse = {
  itemId: string;
  kind: string;
  message: string;
  book?: BookResult;
  notes?: { chunksSaved: number; stonesLinked: number; unchanged: boolean; replaced: boolean };
  question?: { topic: string; missed: boolean; stone: { id: string; title: string } | null; practiceAdded: number };
};

export type BuildSyllabusResponse = BookResult & { message: string };

export const api = {
  path: () => withOfflineCopy(() => request<PathView>("/api/path"), cachePath, cachedPath),
  lesson: (stoneId: string, refresh = false) =>
    withOfflineCopy(
      () => request<LessonView>("/api/lessons/generate", { method: "POST", body: JSON.stringify({ stoneId, refresh }) }),
      cacheLesson,
      () => (refresh ? Promise.resolve(null) : cachedLesson(stoneId)),
    ),
  attempt: (body: AttemptRequest) => request<GradeResult>("/api/practice/attempt", { method: "POST", body: JSON.stringify(body) }),
  complete: (stoneId: string) => request<CompleteResult>(`/api/stones/${stoneId}/complete`, { method: "POST" }),
  readiness: () => request<ReadinessView>("/api/readiness"),
  magicAdd: (body: FormData | { text: string; as?: string; notebookId?: string; notebook?: string }) =>
    request<MagicAddResponse>("/api/magic-ingest", { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body) }),
  buildSyllabus: (body: FormData | { title?: string; isbn?: string }) =>
    request<BuildSyllabusResponse>("/api/books/build-syllabus", { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body) }),
  noteSources: () => request<{ sources: NoteSourceView[] }>("/api/notes/sources"),
  notebooks: () => request<{ notebooks: NotebookView[] }>("/api/notebooks"),
  createNotebook: (name: string, color?: NotebookColor) =>
    request<NotebookView>("/api/notebooks", { method: "POST", body: JSON.stringify({ name, color }) }),
  textbooks: () => request<{ textbooks: TextbookView[] }>("/api/textbooks"),
  registerPart: (textbookId: string, body: { part: number; parts: number; bytes: number; contentHash: string }) =>
    request<TextbookPartView>(`/api/textbooks/${textbookId}/parts`, { method: "POST", body: JSON.stringify(body) }),
  processPart: (textbookId: string, part: number) =>
    request<ProcessPartResult>(`/api/textbooks/${textbookId}/process`, { method: "POST", body: JSON.stringify({ part }) }),
  coursePlan: (courseId: string) => request<{ plan: CoursePlanView | null }>(`/api/course-plans/${courseId}`),
  generateCoursePlan: (courseId: string, force = false) =>
    request<{ plan: CoursePlanView }>("/api/course-plans/generate", { method: "POST", body: JSON.stringify({ courseId, force }) }),
  ask: (body: { stoneId: string; cardId: string; question: string }) =>
    request<AskAnswer>("/api/lessons/ask", { method: "POST", body: JSON.stringify(body) }),
  search: (q: string) => request<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  today: (timeZone: string | null) => request<TodayView>(`/api/planner/today${timeZone ? `?tz=${encodeURIComponent(timeZone)}` : ""}`),
  studyProfile: () => request<StudyProfileView>("/api/planner/profile"),
  saveStudyProfile: (body: Partial<StudyProfileView>) => request<StudyProfileView>("/api/planner/profile", { method: "PUT", body: JSON.stringify(body) }),
  studyBlocks: () => request<{ blocks: StudyBlockView[] }>("/api/planner/blocks"),
  saveStudyBlocks: (blocks: StudyBlockView[]) =>
    request<{ blocks: StudyBlockView[] }>("/api/planner/blocks", {
      method: "PUT",
      body: JSON.stringify({ blocks: blocks.map(({ weekday, start, minutes, courseId }) => ({ weekday, start, minutes, courseId })) }),
    }),
  logStudyMinutes: (minutes: number) => request<{ minutes: number }>("/api/planner/activity", { method: "POST", body: JSON.stringify({ minutes }) }),
  review: (stoneId: string, startedAt: string) => request<ReviewResult>(`/api/reviews/${stoneId}`, { method: "POST", body: JSON.stringify({ startedAt }) }),
  weeklyReports: () => request<{ lastWeek: WeeklyReportView; thisWeek: WeeklyReportView }>("/api/reports/weekly"),
  decks: () => request<{ decks: DeckView[] }>("/api/decks"),
  deck: (deckId: string) => request<DeckView>(`/api/decks/${deckId}`),
  importDeck: (body: { storagePath: string; fileName: string | null } | { text: string; fileName: string | null }) =>
    request<DeckView>("/api/decks/import", { method: "POST", body: JSON.stringify(body) }),
  setDeckCap: (deckId: string, checkCap: number) => request<DeckView>(`/api/decks/${deckId}`, { method: "PUT", body: JSON.stringify({ checkCap }) }),
  deleteDeck: (deckId: string) => request<{ deleted: boolean }>(`/api/decks/${deckId}`, { method: "DELETE" }),
  checkDeck: (deckId: string) => request<DeckCheckProgress>(`/api/decks/${deckId}/check`, { method: "POST" }),
  deckChecks: (deckId: string) => request<{ pending: CardCheckView[]; counts: Record<CardVerdict, number> }>(`/api/decks/${deckId}/checks`),
  decideCheck: (checkId: string, decision: "accepted" | "dismissed") =>
    request<CardCheckView>(`/api/card-checks/${checkId}/decision`, { method: "POST", body: JSON.stringify({ decision }) }),
  deckSuggestions: (deckId: string) => request<{ suggestions: CardSuggestionView[] }>(`/api/decks/${deckId}/suggest`),
  suggestCards: (deckId: string) =>
    request<{ added: number; stonesLeft: number; suggestions: CardSuggestionView[] }>(`/api/decks/${deckId}/suggest`, { method: "POST" }),
  decideSuggestion: (suggestionId: string, decision: "accepted" | "dismissed") =>
    request<{ cardId: string | null }>(`/api/card-suggestions/${suggestionId}/decision`, { method: "POST", body: JSON.stringify({ decision }) }),
  stoneCards: (stoneId: string) => request<{ cards: DeckCardView[] }>(`/api/stones/${stoneId}/cards`),
  games: () => request<{ games: GameSummary[] }>("/api/games"),
  startRound: (game: GameId, stoneIds?: string[]) => request<GameRound>(`/api/games/${game}/round`, { method: "POST", body: JSON.stringify({ stoneIds }) }),
  answerRound: (roundId: string, answer: GameAnswer, durationMs: number) =>
    request<GameResult>(`/api/games/rounds/${roundId}/answer`, { method: "POST", body: JSON.stringify({ answer, durationMs }) }),
  exams: () => request<{ exams: ExamSummary[] }>("/api/exams"),
  startExam: (length: "short" | "long") => request<ExamState>("/api/exams", { method: "POST", body: JSON.stringify({ length }) }),
  exam: (examId: string) => request<ExamState>(`/api/exams/${examId}`),
  answerExam: (examId: string, body: AttemptRequest) => request<ExamAnswerResult>(`/api/exams/${examId}/answer`, { method: "POST", body: JSON.stringify(body) }),
  endExam: (examId: string) => request<ExamState>(`/api/exams/${examId}/end`, { method: "POST" }),
  drugCards: () => request<{ cards: { id: string; name: string; drugClass: string }[] }>("/api/drug-cards"),
  drugCard: (cardId: string) => request<DrugCardView>(`/api/drug-cards/${cardId}`),
  createDrugCard: (name: string) => request<DrugCardView>("/api/drug-cards", { method: "POST", body: JSON.stringify({ name }) }),
  deleteDrugCard: (cardId: string) => request<{ ok: boolean }>(`/api/drug-cards/${cardId}`, { method: "DELETE" }),
  mistakes: () => request<{ mistakes: MistakeView[] }>("/api/mistakes"),
  saveMistakeNote: (itemId: string, note: string) => request<{ note: string }>(`/api/mistakes/${itemId}/note`, { method: "PUT", body: JSON.stringify({ note }) }),
  stoneNgn: (stoneId: string) => request<{ items: PracticeView[] }>(`/api/stones/${stoneId}/ngn`),
  moreNgn: (stoneId: string) => request<{ items: PracticeView[] }>(`/api/stones/${stoneId}/ngn`, { method: "POST" }),
  skills: () => request<{ skills: SkillSummary[] }>("/api/skills"),
  skill: (skillId: string) => request<SkillView>(`/api/skills/${skillId}`),
  runSkill: (skillId: string, done: number[], confidence: SkillConfidence) =>
    request<SkillRunResult>(`/api/skills/${skillId}/runs`, { method: "POST", body: JSON.stringify({ done, confidence }) }),
  signOffSkill: (skillId: string, signedOffOn: string | null) =>
    request<{ signedOffOn: string | null }>(`/api/skills/${skillId}/signoff`, { method: "PUT", body: JSON.stringify({ signedOffOn }) }),
  clinicalPreps: () => request<{ preps: ClinicalPrepSummary[] }>("/api/clinical-preps"),
  clinicalPrep: (prepId: string) => request<ClinicalPrepView>(`/api/clinical-preps/${prepId}`),
  createClinicalPrep: (input: ClinicalInput) => request<ClinicalPrepView>("/api/clinical-preps", { method: "POST", body: JSON.stringify(input) }),
  deleteClinicalPrep: (prepId: string) => request<{ ok: boolean }>(`/api/clinical-preps/${prepId}`, { method: "DELETE" }),
  carePlans: () => request<{ plans: CarePlanSummary[] }>("/api/care-plans"),
  carePlan: (planId: string) => request<CarePlanView>(`/api/care-plans/${planId}`),
  createCarePlan: (situation: string, prepId: string | null) =>
    request<CarePlanView>("/api/care-plans", { method: "POST", body: JSON.stringify({ situation, prepId }) }),
  saveCarePlan: (planId: string, problems: CarePlanProblem[]) =>
    request<CarePlanView>(`/api/care-plans/${planId}`, { method: "PUT", body: JSON.stringify({ problems }) }),
  checkCarePlan: (planId: string) => request<CarePlanView>(`/api/care-plans/${planId}/check`, { method: "POST" }),
  deleteCarePlan: (planId: string) => request<{ ok: boolean }>(`/api/care-plans/${planId}`, { method: "DELETE" }),
  shareLinks: () => request<{ links: ShareLinkView[] }>("/api/share"),
  createShareLink: (kind: ShareKind, stoneId: string) => request<ShareLinkView>("/api/share", { method: "POST", body: JSON.stringify({ kind, stoneId }) }),
  revokeShareLink: (shareId: string) => request<ShareLinkView>(`/api/share/${shareId}`, { method: "DELETE" }),
};

// Sends answers and finished lessons saved while offline. Safe to call any time; returns how many went.
export function syncOutbox(): Promise<number> {
  return flushOutbox(async (entry: OutboxEntry) => {
    if (entry.kind === "attempt") await api.attempt(entry.body);
    else await api.complete(entry.stoneId);
  }, isOfflineError);
}

// ---------------------------------------------------------------------------
// Share links, opened by anyone: no sign-in, so these skip the session.
// ---------------------------------------------------------------------------

async function publicRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers: typeof init.body === "string" ? { "content-type": "application/json" } : undefined });
  } catch {
    throw new ClientApiError("You seem to be offline. Check your connection and try again.", "offline", 0);
  }
  const body = (await response.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!response.ok) throw new ClientApiError(body?.error?.message ?? "Something went wrong. Try again.", body?.error?.code ?? "error", response.status);
  return body as T;
}

export const shared = {
  open: (token: string) => publicRequest<SharedDeckView>(`/api/shared/${encodeURIComponent(token)}`),
  answer: (token: string, body: AttemptRequest) =>
    publicRequest<SharedGrade>(`/api/shared/${encodeURIComponent(token)}/answer`, { method: "POST", body: JSON.stringify(body) }),
};

// The address a share link opens at: the hosted app, also from inside the Android app.
export function shareUrl(token: string): string {
  const base = API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/share?t=${encodeURIComponent(token)}`;
}

// Downloads a file from the API (signed in), for the deck export.
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const session = await ensureSession();
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${session.access_token}` } });
  } catch {
    throw new ClientApiError("You seem to be offline. Check your connection and try again.", "offline", 0);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    throw new ClientApiError(body?.error?.message ?? "The download didn't work. Try again.", body?.error?.code ?? "error", response.status);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const name = encoded ? decodeURIComponent(encoded) : fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// The phone's own time zone, for the planner's calendar days.
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
