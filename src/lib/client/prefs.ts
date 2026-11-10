// Small per-device preferences kept in localStorage. Every read and write is guarded: storage can be
// missing or blocked (private windows, some WebViews), and the app must work without it.

export const SWIPE_HINT_KEY = "lpn:swipe-hint-seen";
export const SWIPE_HINT_LESSONS = 3;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readCount(key: string, store: Storage | null = storage()): number {
  try {
    const n = Number(store?.getItem(key) ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function bumpCount(key: string, store: Storage | null = storage()): number {
  const next = readCount(key, store) + 1;
  try {
    store?.setItem(key, String(next));
  } catch {
    // Storage full or blocked: the hint just keeps showing.
  }
  return next;
}

// The "Swipe or tap the sides" hint shows for the first few lessons only.
export function shouldShowSwipeHint(lessonsSeen: number): boolean {
  return lessonsSeen < SWIPE_HINT_LESSONS;
}

export function readString(key: string, store: Storage | null = storage()): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string, store: Storage | null = storage()): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Ignore: only a convenience.
  }
}
