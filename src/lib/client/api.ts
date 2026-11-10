import type {
  ApiErrorBody,
  AttemptRequest,
  CompleteResult,
  GradeResult,
  LessonView,
  NoteSourceView,
  PathView,
  ReadinessView,
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
  magicAdd: (body: FormData | { text: string; as?: string }) =>
    request<MagicAddResponse>("/api/magic-ingest", { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body) }),
  buildSyllabus: (body: FormData | { title?: string; isbn?: string }) =>
    request<BuildSyllabusResponse>("/api/books/build-syllabus", { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body) }),
  noteSources: () => request<{ sources: NoteSourceView[] }>("/api/notes/sources"),
};
