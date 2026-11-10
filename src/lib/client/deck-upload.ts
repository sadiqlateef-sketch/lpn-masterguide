import type { DeckView } from "@/lib/api-types";
import { ANKI_DECK_MAX_BYTES, ankiDeckPath } from "@/lib/anki-paths";
import { api } from "./api";
import { browserSupabase, ensureSession } from "./supabase";

// Sends an Anki deck: the file goes straight to the student's private Storage folder (decks are often
// too big for an API request), then the server reads it from there.

const ACCEPTED = /\.(apkg|colpkg|txt|tsv|csv)$/i;

export async function uploadDeck(file: File, onStage: (stage: "uploading" | "reading") => void): Promise<DeckView> {
  if (!ACCEPTED.test(file.name)) throw new Error("Pick an Anki deck (.apkg) or a plain-text export (.txt).");
  if (file.size > ANKI_DECK_MAX_BYTES) throw new Error("That deck is over 50 MB. In Anki, export it without media and try again.");

  const session = await ensureSession();
  onStage("uploading");
  const path = ankiDeckPath(session.user.id, crypto.randomUUID(), file.name);
  const { error } = await browserSupabase()
    .storage.from("uploads")
    .upload(path, file, { upsert: false, contentType: "application/octet-stream" });
  if (error) throw new Error("The deck didn't upload. Check your connection and try again.");
  onStage("reading");
  return api.importDeck({ storagePath: path, fileName: file.name });
}
