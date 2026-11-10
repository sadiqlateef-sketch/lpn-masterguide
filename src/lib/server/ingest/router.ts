import { COURSE_IDS, type CourseId } from "@/lib/blueprint-ids";
import type { IngestKind } from "../ai-schemas";
import { buildSyllabus, type BuildSyllabusResult } from "../books/syllabus";
import { ApiError } from "../http";
import { check, type UserContext } from "../supabase";
import { storeOriginals, type ParsedUpload } from "../uploads";
import { classifyImages, classifyText, ingestKindFor, type RouteDecision } from "./classify";
import { ingestNotes, type NotesIngestResult } from "./notes";
import { ingestUWorld, type UWorldIngestResult } from "./uworld";

export type MagicAddResult = {
  itemId: string;
  kind: IngestKind;
  message: string;
  book?: BuildSyllabusResult;
  notes?: NotesIngestResult;
  question?: UWorldIngestResult;
};

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function bookMessage(result: BuildSyllabusResult): string {
  switch (result.status) {
    case "created": {
      const extras = [
        result.linked.notes && `linked ${plural(result.linked.notes, "note")}`,
        result.linked.questions && `linked ${plural(result.linked.questions, "saved question")}`,
      ].filter(Boolean);
      return `Added ${result.title}: ${plural(result.counts.units, "unit")} and ${plural(result.counts.stones, "stepping stone")}.${
        extras.length ? ` Also ${extras.join(" and ")}.` : ""
      }`;
    }
    case "duplicate":
      return `${result.title} is already on your path.`;
    case "needs_toc_photo":
      return result.book
        ? `I found ${result.book.title}, but not its chapter list. Snap photos of its table of contents.`
        : "I couldn't find that book. Snap photos of its table of contents.";
  }
}

export function notesMessage(result: NotesIngestResult): string {
  if (result.unchanged) return "Those notes are already up to date.";
  const pearls = result.sources.reduce((n, s) => n + s.pearls, 0);
  const base = `Saved ${plural(result.chunksSaved, "note card")}${pearls ? ` with ${plural(pearls, "exam pearl")}` : ""}.`;
  const lead = result.replaced ? `Updated your notes. ${base}` : base;
  if (result.stonesLinked > 0) return `${lead} Linked to ${plural(result.stonesLinked, "stepping stone")}.`;
  return `${lead} They'll link up when you add the matching school book.`;
}

export function questionMessage(result: UWorldIngestResult): string {
  if (!result.stone) {
    return `Saved your ${result.topic} question. It'll link up when you add the matching school book.`;
  }
  if (!result.missed) return `Nice! Saved your ${result.topic} question to "${result.stone.title}".`;
  return `Saved your ${result.topic} question to "${result.stone.title}". It's marked for review${
    result.practiceAdded ? ` with ${plural(result.practiceAdded, "new practice question")}` : ""
  }.`;
}

async function decide(upload: ParsedUpload): Promise<RouteDecision> {
  // Folder sync and the "Paste note" button already know the input is notes.
  if (upload.fields.as === "notes" || upload.fields.externalKey) {
    return { route: "notebooklm_note", bookTitle: null, isbn: null, decidedBy: "rules" };
  }
  if (upload.documents.length > 0) return { route: "notebooklm_note", bookTitle: null, isbn: null, decidedBy: "rules" };
  if (upload.images.length > 0) return classifyImages(upload.images);
  return classifyText(upload.text ?? "");
}

function courseFrom(fields: Record<string, string>): CourseId | null {
  const value = fields.courseId ?? fields.course_id;
  return (COURSE_IDS as readonly string[]).includes(value) ? (value as CourseId) : null;
}

// Classifies anything the student adds, runs the matching pipeline, and records the outcome on ingest_items.
export async function magicAdd(ctx: UserContext, upload: ParsedUpload): Promise<MagicAddResult> {
  const item = check(
    await ctx.supabase
      .from("ingest_items")
      .insert({ user_id: ctx.user.id, state: "processing", raw_text: upload.text })
      .select("id")
      .single(),
    "create ingest item",
  ) as { id: string };

  const finish = async (patch: Record<string, unknown>) =>
    check(await ctx.supabase.from("ingest_items").update(patch).eq("id", item.id), "update ingest item");

  try {
    const storagePath = await storeOriginals(ctx, item.id, upload);
    const decision = await decide(upload);
    const kind = ingestKindFor(decision.route);
    await finish({ kind, storage_path: storagePath });

    let result: MagicAddResult;
    switch (decision.route) {
      case "book_title":
      case "book_cover":
      case "toc_photo":
      case "toc_text": {
        const book = await buildSyllabus(ctx, {
          title: decision.route === "book_title" ? (upload.text ?? decision.bookTitle) : decision.bookTitle,
          isbn: decision.isbn,
          tocText: decision.route === "toc_text" ? upload.text : null,
          photos: upload.images,
          courseId: courseFrom(upload.fields),
        });
        result = { itemId: item.id, kind, message: bookMessage(book), book };
        break;
      }
      case "uworld_screenshot":
      case "uworld_text": {
        const question = await ingestUWorld(ctx, { images: upload.images, text: upload.text, ingestItemId: item.id });
        result = { itemId: item.id, kind, message: questionMessage(question), question };
        break;
      }
      case "notebooklm_note": {
        const notes = await ingestNotes(ctx, {
          files: upload.documents,
          images: upload.images,
          text: upload.text,
          ingestItemId: item.id,
          externalKey: upload.fields.externalKey ?? null,
        });
        result = { itemId: item.id, kind, message: notesMessage(notes), notes };
        break;
      }
      case "unknown":
        throw new ApiError(
          422,
          "I'm not sure what that is. Try a book title, a photo of a table of contents, a UWorld screenshot, or your notes.",
          "unknown_input",
        );
    }

    await finish({ state: "done", result, summary: result.message, error: null });
    return result;
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Something went wrong.";
    await finish({ state: "failed", error: message, summary: message }).catch((e) => console.error("Could not record failure", e));
    throw error;
  }
}
