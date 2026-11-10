import type { AttemptRequest, LessonView, PathView } from "@/lib/api-types";

// Offline lessons (F12). Lessons and the path are kept on the phone in IndexedDB as they load, and
// "Save for offline" fetches every lesson in a chapter ahead of time. Answers and finished lessons
// made while offline wait in an outbox and are sent (and checked) once the phone is back online.
// Answers are never stored on the phone: questions are still checked on the server.

const DB_NAME = "lpn-masterguide-offline";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getItem<T>(key: string): Promise<T | null> {
  return ((await run("readonly", (s) => s.get(key))) as T | undefined) ?? null;
}

export async function setItem(key: string, value: unknown): Promise<void> {
  await run("readwrite", (s) => s.put(value, key));
}

export async function removeItem(key: string): Promise<void> {
  await run("readwrite", (s) => s.delete(key));
}

// ---------------------------------------------------------------------------
// Lessons and the path
// ---------------------------------------------------------------------------

const lessonKey = (stoneId: string) => `lesson:${stoneId}`;

export async function cacheLesson(lesson: LessonView): Promise<void> {
  await setItem(lessonKey(lesson.stoneId), lesson);
}

export async function cachedLesson(stoneId: string): Promise<LessonView | null> {
  return getItem<LessonView>(lessonKey(stoneId));
}

export async function cachePath(path: PathView): Promise<void> {
  await setItem("path", path);
}

export async function cachedPath(): Promise<PathView | null> {
  return getItem<PathView>("path");
}

// ---------------------------------------------------------------------------
// Chapters saved for offline
// ---------------------------------------------------------------------------

export type SavedModule = { id: string; title: string; stoneIds: string[]; savedAt: string };

export async function savedModules(): Promise<SavedModule[]> {
  return (await getItem<SavedModule[]>("saved-modules")) ?? [];
}

export async function markModuleSaved(module: Omit<SavedModule, "savedAt">): Promise<void> {
  const others = (await savedModules()).filter((m) => m.id !== module.id);
  await setItem("saved-modules", [...others, { ...module, savedAt: new Date().toISOString() }]);
}

// Forgets the chapter and its lessons, unless another saved chapter still needs a lesson.
export async function forgetModule(moduleId: string): Promise<void> {
  const all = await savedModules();
  const gone = all.find((m) => m.id === moduleId);
  const rest = all.filter((m) => m.id !== moduleId);
  await setItem("saved-modules", rest);
  const stillNeeded = new Set(rest.flatMap((m) => m.stoneIds));
  for (const id of gone?.stoneIds ?? []) if (!stillNeeded.has(id)) await removeItem(lessonKey(id));
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

export type OutboxEntry = { id: string; at: string } & ({ kind: "attempt"; body: AttemptRequest } | { kind: "complete"; stoneId: string });

function entryId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function outbox(): Promise<OutboxEntry[]> {
  return (await getItem<OutboxEntry[]>("outbox")) ?? [];
}

export async function queueAttempt(body: AttemptRequest): Promise<void> {
  // One waiting answer per question: a later answer replaces an earlier one.
  const rest = (await outbox()).filter((e) => !(e.kind === "attempt" && e.body.itemId === body.itemId));
  await setItem("outbox", [...rest, { id: entryId(), at: new Date().toISOString(), kind: "attempt", body }]);
}

export async function queueComplete(stoneId: string): Promise<void> {
  const rest = (await outbox()).filter((e) => !(e.kind === "complete" && e.stoneId === stoneId));
  await setItem("outbox", [...rest, { id: entryId(), at: new Date().toISOString(), kind: "complete", stoneId }]);
}

let flushing: Promise<number> | null = null;

// Sends waiting entries in order, answers before the lesson they finish. Stops at the first one that
// can't reach the server (still offline) and keeps it; drops one the server turns down (like a question
// deleted since), so a bad entry never blocks the rest. Returns how many were sent.
export function flushOutbox(send: (entry: OutboxEntry) => Promise<void>, isOffline: (error: unknown) => boolean): Promise<number> {
  flushing ??= (async () => {
    let sent = 0;
    try {
      const entries = await outbox();
      const ordered = [...entries.filter((e) => e.kind === "attempt"), ...entries.filter((e) => e.kind === "complete")];
      for (const entry of ordered) {
        try {
          await send(entry);
          sent++;
        } catch (error) {
          if (isOffline(error)) break;
        }
        const left = (await outbox()).filter((e) => e.id !== entry.id);
        await setItem("outbox", left);
      }
    } finally {
      flushing = null;
    }
    return sent;
  })();
  return flushing;
}
