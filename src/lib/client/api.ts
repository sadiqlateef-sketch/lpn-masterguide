import type {
  ApiErrorBody,
  AskAnswer,
  AttemptRequest,
  CompleteResult,
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
} from "@/lib/api-types";
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await ensureSession();
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
  path: () => request<PathView>("/api/path"),
  lesson: (stoneId: string, refresh = false) =>
    request<LessonView>("/api/lessons/generate", { method: "POST", body: JSON.stringify({ stoneId, refresh }) }),
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
};

// The phone's own time zone, for the planner's calendar days.
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
