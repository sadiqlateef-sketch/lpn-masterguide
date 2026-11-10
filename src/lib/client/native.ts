import { Capacitor } from "@capacitor/core";

// Phone features. In the Android app these use Capacitor plugins; in a browser they fall back to
// web APIs or do nothing. Plugins are loaded on first use so the web bundle stays small.

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function platform(): string {
  return Capacitor.getPlatform();
}

// ---------------------------------------------------------------------------
// Camera and photo gallery
// ---------------------------------------------------------------------------

const PHOTO_OPTIONS = { quality: 88, targetWidth: 2400, targetHeight: 2400, correctOrientation: true } as const;

export class PhotoAccessError extends Error {
  constructor() {
    super("The app needs permission to use your camera and photos. Turn it on in your phone's Settings > Apps > LPN MasterGuide > Permissions.");
    this.name = "PhotoAccessError";
  }
}

function cancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel/i.test(message);
}

function denied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /denied|permission/i.test(message);
}

async function toFile(webPath: string, name: string): Promise<File> {
  const blob = await (await fetch(webPath)).blob();
  const type = blob.type || "image/jpeg";
  const ext = type === "image/png" ? "png" : "jpg";
  return new File([blob], `${name}.${ext}`, { type, lastModified: Date.now() });
}

// Opens the camera. Returns null if the student backs out.
export async function takePhoto(): Promise<File | null> {
  const { Camera } = await import("@capacitor/camera");
  try {
    const result = await Camera.takePhoto({ ...PHOTO_OPTIONS, saveToGallery: false });
    return result.webPath ? toFile(result.webPath, `photo-${Date.now()}`) : null;
  } catch (error) {
    if (cancelled(error)) return null;
    if (denied(error)) throw new PhotoAccessError();
    throw error;
  }
}

// Opens the photo gallery for up to `limit` pictures (screenshots live here). Returns [] if the student backs out.
export async function pickPhotos(limit = 10): Promise<File[]> {
  const { Camera, MediaTypeSelection } = await import("@capacitor/camera");
  try {
    const { results } = await Camera.chooseFromGallery({
      ...PHOTO_OPTIONS,
      mediaType: MediaTypeSelection.Photo,
      allowMultipleSelection: limit > 1,
      limit,
    });
    const stamp = Date.now();
    return Promise.all(results.filter((r) => r.webPath).map((r, i) => toFile(r.webPath!, `photo-${stamp}-${i + 1}`)));
  } catch (error) {
    if (cancelled(error)) return [];
    if (denied(error)) throw new PhotoAccessError();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

export type HapticKind = "tap" | "success" | "error" | "celebrate";

const WEB_PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 10,
  success: 30,
  error: [60, 40, 60],
  celebrate: [40, 30, 40, 30, 80],
};

export async function haptic(kind: HapticKind): Promise<void> {
  try {
    if (!isNative()) {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(WEB_PATTERNS[kind]);
      return;
    }
    const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
    if (kind === "tap") await Haptics.impact({ style: ImpactStyle.Light });
    else if (kind === "success") await Haptics.notification({ type: NotificationType.Success });
    else if (kind === "error") await Haptics.notification({ type: NotificationType.Error });
    else {
      await Haptics.notification({ type: NotificationType.Success });
      await new Promise((resolve) => setTimeout(resolve, 120));
      await Haptics.impact({ style: ImpactStyle.Heavy });
    }
  } catch {
    // Haptics are a bonus; a phone without a vibration motor shouldn't break anything.
  }
}

// ---------------------------------------------------------------------------
// Read aloud. Android's WebView has no reliable speechSynthesis, so the app uses the phone's own
// text-to-speech engine there.
// ---------------------------------------------------------------------------

export function speechAvailable(): boolean {
  if (isNative()) return true;
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

let webUtterance: SpeechSynthesisUtterance | null = null;

// Resolves when the text has finished (or was stopped).
export async function speak(text: string, rate = 0.95): Promise<void> {
  if (isNative()) {
    const { TextToSpeech } = await import("@capacitor-community/text-to-speech");
    await TextToSpeech.stop().catch(() => undefined);
    await TextToSpeech.speak({ text, lang: "en-US", rate, pitch: 1, volume: 1, category: "playback" });
    return;
  }
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  await new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    webUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  });
  webUtterance = null;
}

export async function stopSpeaking(): Promise<void> {
  if (isNative()) {
    const { TextToSpeech } = await import("@capacitor-community/text-to-speech");
    await TextToSpeech.stop().catch(() => undefined);
    return;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  webUtterance = null;
}

// ---------------------------------------------------------------------------
// Android system bars, splash screen and back button
// ---------------------------------------------------------------------------

export async function setupNativeChrome(): Promise<void> {
  if (!isNative()) return;
  const [{ StatusBar, Style }, { SplashScreen }] = await Promise.all([import("@capacitor/status-bar"), import("@capacitor/splash-screen")]);
  await Promise.allSettled([StatusBar.setStyle({ style: Style.Dark }), StatusBar.setBackgroundColor({ color: "#020617" })]);
  await SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => undefined);
}

// Calls `handler` when the Android back button is pressed. Return true if it was handled; otherwise
// the app goes to the background like any other Android app.
export function onBackButton(handler: () => boolean): () => void {
  if (!isNative()) return () => undefined;
  let remove: (() => void) | null = null;
  let disposed = false;
  void import("@capacitor/app").then(async ({ App }) => {
    const listener = await App.addListener("backButton", () => {
      if (!handler()) void App.minimizeApp();
    });
    if (disposed) void listener.remove();
    else remove = () => void listener.remove();
  });
  return () => {
    disposed = true;
    remove?.();
  };
}
