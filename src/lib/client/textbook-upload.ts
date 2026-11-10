import type { ProcessPartResult } from "@/lib/api-types";
import {
  halveRange,
  planSplit,
  TEXTBOOK_MAX_BYTES,
  TEXTBOOK_MAX_PARTS,
  TEXTBOOK_PART_MAX_BYTES,
  TEXTBOOK_PART_TARGET_BYTES,
  textbookPartPath,
  type PageRange,
} from "@/lib/textbook-parts";
import { api } from "./api";
import { browserSupabase, ensureSession } from "./supabase";

// Sends a whole textbook PDF: split on the phone into parts small enough to upload, each part
// straight to the student's own Storage folder, then read by the server one part at a time.
// Running it again with the same file skips parts the server already read.

export type UploadProgress =
  | { stage: "splitting" }
  | { stage: "uploading" | "reading"; part: number; parts: number }
  | { stage: "done"; result: ProcessPartResult };

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function splitPdf(file: File): Promise<Blob[]> {
  if (file.size <= TEXTBOOK_PART_TARGET_BYTES) return [file];
  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
  const queue: PageRange[] = planSplit(file.size, source.getPageCount());
  const parts: Blob[] = [];
  while (queue.length) {
    const range = queue.shift()!;
    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(
      source,
      Array.from({ length: range.to - range.from + 1 }, (_, i) => range.from - 1 + i),
    );
    for (const page of pages) doc.addPage(page);
    const bytes = await doc.save();
    // Pictures cluster in some chapters; a part that came out too big is halved and tried again.
    if (bytes.byteLength > TEXTBOOK_PART_MAX_BYTES) {
      const halves = halveRange(range);
      if (!halves) throw new Error(`Page ${range.from} of this PDF is too big to upload on its own.`);
      queue.unshift(...halves);
      continue;
    }
    parts.push(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
    if (parts.length > TEXTBOOK_MAX_PARTS) throw new Error(`This book needs more than ${TEXTBOOK_MAX_PARTS} parts. Try a smaller export.`);
  }
  return parts;
}

export async function uploadTextbookPdf(file: File, textbookId: string, onProgress: (p: UploadProgress) => void): Promise<ProcessPartResult> {
  if (file.type && file.type !== "application/pdf") throw new Error("Pick the book as a PDF file.");
  if (file.size > TEXTBOOK_MAX_BYTES) throw new Error("That PDF is over 400 MB. Try exporting it in two halves.");

  onProgress({ stage: "splitting" });
  let parts: Blob[];
  try {
    parts = await splitPdf(file);
  } catch (error) {
    if (error instanceof Error && /too big|more than/.test(error.message)) throw error;
    throw new Error("That PDF couldn't be opened. If it has a password, export a copy without one.");
  }

  const session = await ensureSession();
  let result: ProcessPartResult | null = null;
  for (let i = 0; i < parts.length; i++) {
    const part = i + 1;
    const bytes = await parts[i].arrayBuffer();
    const registered = await api.registerPart(textbookId, {
      part,
      parts: parts.length,
      bytes: bytes.byteLength,
      contentHash: await sha256Hex(bytes),
    });
    if (registered.state !== "done" && registered.state !== "no_text") {
      onProgress({ stage: "uploading", part, parts: parts.length });
      const { error } = await browserSupabase()
        .storage.from("uploads")
        .upload(textbookPartPath(session.user.id, textbookId, part), parts[i], { upsert: true, contentType: "application/pdf" });
      if (error) throw new Error(`Part ${part} didn't upload. Check your connection and try again; finished parts are kept.`);
    }
    onProgress({ stage: "reading", part, parts: parts.length });
    result = await api.processPart(textbookId, part);
  }
  onProgress({ stage: "done", result: result! });
  return result!;
}
