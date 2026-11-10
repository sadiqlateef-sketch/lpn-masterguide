import { extractText, getDocumentProxy } from "unpdf";
import type { ProcessPartResult, TextbookPartState, TextbookPartView, TextbookView } from "@/lib/api-types";
import { TEXTBOOK_MAX_PARTS, TEXTBOOK_PART_MAX_BYTES, textbookPartPath } from "@/lib/textbook-parts";
import { embed, toPgVector } from "../embeddings";
import { ApiError } from "../http";
import { contentHash } from "../ingest/notes";
import { invalidateLessons } from "../path";
import { check, type UserContext } from "../supabase";
import { chunkPdfPages, passageEmbeddingText, type PdfChunk } from "../text/pdf-chunk";
import { sniffMatches } from "../uploads";

const INSERT_BATCH = 100;
const LINK_THRESHOLD = 0.35;
// Below this many characters per page, a part is almost certainly scanned images without a text layer.
const MIN_CHARS_PER_PAGE = 120;

type FileRow = {
  id: string;
  part_number: number;
  storage_path: string;
  bytes: number;
  content_hash: string;
  page_offset: number;
  pages: number | null;
  chunks: number;
  state: TextbookPartState;
  error: string | null;
};

function partView(row: Pick<FileRow, "part_number" | "state" | "pages" | "chunks" | "error">): TextbookPartView {
  return { part: row.part_number, state: row.state, pages: row.pages, chunks: row.chunks, error: row.error };
}

type BookRow = {
  id: string;
  title: string;
  course_id: string;
  pdf_parts: number | null;
  units: { modules: { stepping_stones: { count: number }[] }[] }[];
};

async function loadBook(ctx: UserContext, textbookId: string): Promise<BookRow> {
  const book = check(
    await ctx.supabase
      .from("textbooks")
      .select("id, title, course_id, pdf_parts, units(modules(stepping_stones(count)))")
      .eq("id", textbookId)
      .maybeSingle(),
    "load textbook",
  ) as BookRow | null;
  if (!book) throw new ApiError(404, "That book isn't on your path.", "not_found");
  return book;
}

async function loadFiles(ctx: UserContext, textbookId: string): Promise<FileRow[]> {
  return check(
    await ctx.supabase
      .from("textbook_files")
      .select("id, part_number, storage_path, bytes, content_hash, page_offset, pages, chunks, state, error")
      .eq("textbook_id", textbookId)
      .order("part_number"),
    "load textbook parts",
  ) as FileRow[];
}

function stoneCount(book: BookRow): number {
  return book.units.reduce((n, u) => n + u.modules.reduce((m, mod) => m + (mod.stepping_stones[0]?.count ?? 0), 0), 0);
}

async function countPassages(ctx: UserContext, textbookId: string, linkedOnly: boolean): Promise<number> {
  let query = ctx.supabase.from("textbook_chunks").select("id", { count: "exact", head: true }).eq("textbook_id", textbookId);
  if (linkedOnly) query = query.not("stone_id", "is", null);
  const { count, error } = await query;
  if (error) {
    console.error("Supabase count passages failed:", error.message);
    throw new ApiError(500, "Saving didn't work. Try again.", "db_error");
  }
  return count ?? 0;
}

export async function listTextbooks(ctx: UserContext): Promise<TextbookView[]> {
  const books = check(
    await ctx.supabase.from("textbooks").select("id, title, course_id, pdf_parts, units(modules(stepping_stones(count)))").order("created_at"),
    "list textbooks",
  ) as BookRow[];
  return Promise.all(
    books.map(async (book) => {
      const files = await loadFiles(ctx, book.id);
      const pdf =
        book.pdf_parts || files.length
          ? {
              parts: book.pdf_parts,
              uploaded: files.map(partView),
              passages: files.reduce((n, f) => n + f.chunks, 0),
              passagesLinked: files.some((f) => f.chunks > 0) ? await countPassages(ctx, book.id, true) : 0,
            }
          : null;
      return { id: book.id, title: book.title, courseId: book.course_id, stones: stoneCount(book), pdf };
    }),
  );
}

export type RegisterPartInput = { part: number; parts: number; bytes: number; contentHash: string };

export function validatePartInput(input: RegisterPartInput) {
  if (!Number.isInteger(input.parts) || input.parts < 1 || input.parts > TEXTBOOK_MAX_PARTS) {
    throw new ApiError(400, `A book can be split into at most ${TEXTBOOK_MAX_PARTS} parts.`, "bad_parts");
  }
  if (!Number.isInteger(input.part) || input.part < 1 || input.part > input.parts) {
    throw new ApiError(400, "That part number doesn't fit the book.", "bad_part");
  }
  if (!Number.isFinite(input.bytes) || input.bytes <= 0 || input.bytes > TEXTBOOK_PART_MAX_BYTES) {
    throw new ApiError(413, "That part is too big. Each part has to be under 45 MB.", "part_too_big");
  }
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) throw new ApiError(400, "That upload couldn't be checked.", "bad_hash");
}

async function removeStored(ctx: UserContext, paths: string[]) {
  if (paths.length === 0) return;
  const { error } = await ctx.supabase.storage.from("uploads").remove(paths);
  if (error) console.warn("Could not remove old textbook parts from storage", error.message);
}

// Records a part the phone already uploaded to Storage. A new split of the same book starts it over.
export async function registerPart(ctx: UserContext, textbookId: string, input: RegisterPartInput): Promise<TextbookPartView> {
  validatePartInput(input);
  const book = await loadBook(ctx, textbookId);
  const files = await loadFiles(ctx, textbookId);

  if (book.pdf_parts !== null && book.pdf_parts !== input.parts) {
    const stones = await linkedStones(ctx, textbookId);
    check(await ctx.supabase.from("textbook_files").delete().eq("textbook_id", textbookId), "reset textbook parts");
    // Parts up to the new count are overwritten by the new upload; only the extra old ones need removing.
    await removeStored(
      ctx,
      files.filter((f) => f.part_number > input.parts).map((f) => f.storage_path),
    );
    await invalidateLessons(ctx, stones);
    files.length = 0;
  }
  if (book.pdf_parts !== input.parts) {
    check(await ctx.supabase.from("textbooks").update({ pdf_parts: input.parts }).eq("id", textbookId), "save part count");
  }

  const existing = files.find((f) => f.part_number === input.part);
  if (existing && existing.content_hash === input.contentHash && existing.state !== "failed") return partView(existing);
  if (existing) {
    const stones = await linkedStones(ctx, textbookId, existing.id);
    check(await ctx.supabase.from("textbook_files").delete().eq("id", existing.id), "replace textbook part");
    await invalidateLessons(ctx, stones);
  }

  const row = check(
    await ctx.supabase
      .from("textbook_files")
      .insert({
        user_id: ctx.user.id,
        textbook_id: textbookId,
        part_number: input.part,
        storage_path: textbookPartPath(ctx.user.id, textbookId, input.part),
        bytes: input.bytes,
        content_hash: input.contentHash,
      })
      .select("part_number, state, pages, chunks, error")
      .single(),
    "save textbook part",
  ) as Pick<FileRow, "part_number" | "state" | "pages" | "chunks" | "error">;
  return partView(row);
}

async function linkedStones(ctx: UserContext, textbookId: string, fileId?: string): Promise<string[]> {
  let query = ctx.supabase.from("textbook_chunks").select("stone_id").eq("textbook_id", textbookId).not("stone_id", "is", null);
  if (fileId) query = query.eq("file_id", fileId);
  const rows = check(await query.limit(5000), "find textbook stones") as { stone_id: string }[];
  return [...new Set(rows.map((r) => r.stone_id))];
}

// The page number (in the whole book) where a part starts: every earlier part must be read first.
export function pageOffsetFor(files: readonly Pick<FileRow, "part_number" | "pages" | "state">[], part: number): number {
  let offset = 0;
  for (let n = 1; n < part; n++) {
    const earlier = files.find((f) => f.part_number === n);
    if (!earlier || earlier.pages === null || (earlier.state !== "done" && earlier.state !== "no_text")) {
      throw new ApiError(409, `Read part ${n} of this book first.`, "earlier_part_missing");
    }
    offset += earlier.pages;
  }
  return offset;
}

export function looksScanned(pages: readonly string[]): boolean {
  if (pages.length === 0) return true;
  const chars = pages.reduce((n, p) => n + p.replace(/\s+/g, "").length, 0);
  return chars / pages.length < MIN_CHARS_PER_PAGE;
}

async function readPages(bytes: Uint8Array): Promise<string[]> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    return text;
  } catch (error) {
    console.warn("Could not read textbook part", error);
    throw new ApiError(422, "That PDF part couldn't be opened. Try exporting the book again.", "bad_pdf");
  }
}

export function processMessage(title: string, part: number, parts: number | null, state: TextbookPartState, chunks: number, complete: boolean): string {
  const of = parts ? ` of ${parts}` : "";
  if (state === "no_text") {
    return `Part ${part}${of} of ${title} looks like scanned pages with no text to read, so it was skipped.`;
  }
  const base = `Read part ${part}${of} of ${title}: ${chunks} passage${chunks === 1 ? "" : "s"}.`;
  return complete ? `${base} The whole book is in, and your lessons will use it.` : base;
}

// Reads one uploaded part: pulls its text, splits it into passages with page numbers, embeds them,
// and links each passage to the closest stepping stone of the same book.
export async function processPart(ctx: UserContext, textbookId: string, part: number): Promise<ProcessPartResult> {
  const book = await loadBook(ctx, textbookId);
  const files = await loadFiles(ctx, textbookId);
  const file = files.find((f) => f.part_number === part);
  if (!file) throw new ApiError(404, `Part ${part} of this book hasn't been uploaded yet.`, "not_found");

  const isComplete = (rows: readonly FileRow[]) =>
    book.pdf_parts !== null &&
    Array.from({ length: book.pdf_parts }, (_, i) => rows.find((r) => r.part_number === i + 1)).every(
      (r) => r && (r.state === "done" || r.state === "no_text"),
    );

  if (file.state === "done" || file.state === "no_text") {
    return {
      part: partView(file),
      passagesLinked: 0,
      stonesLinked: 0,
      complete: isComplete(files),
      message: processMessage(book.title, part, book.pdf_parts, file.state, file.chunks, isComplete(files)),
    };
  }

  const offset = pageOffsetFor(files, part);
  const setFile = async (patch: Record<string, unknown>) =>
    check(await ctx.supabase.from("textbook_files").update(patch).eq("id", file.id), "update textbook part");
  await setFile({ state: "processing", error: null, page_offset: offset });

  try {
    const download = await ctx.supabase.storage.from("uploads").download(file.storage_path);
    if (download.error || !download.data) {
      throw new ApiError(404, `Part ${part} didn't finish uploading. Add the book again.`, "upload_missing");
    }
    const bytes = new Uint8Array(await download.data.arrayBuffer());
    if (!sniffMatches("application/pdf", bytes)) throw new ApiError(415, "That part isn't a real PDF.", "bad_file");
    if (contentHash(bytes) !== file.content_hash) {
      throw new ApiError(409, `Part ${part} changed while uploading. Add the book again.`, "hash_mismatch");
    }

    const pages = await readPages(bytes);
    if (looksScanned(pages)) {
      await setFile({ state: "no_text", pages: pages.length, chunks: 0 });
      const updated = files.map((f) => (f.id === file.id ? { ...f, state: "no_text" as const, pages: pages.length } : f));
      return {
        part: { part, state: "no_text", pages: pages.length, chunks: 0, error: null },
        passagesLinked: 0,
        stonesLinked: 0,
        complete: isComplete(updated),
        message: processMessage(book.title, part, book.pdf_parts, "no_text", 0, isComplete(updated)),
      };
    }

    const chunks = chunkPdfPages(pages, offset + 1);
    await savePassages(ctx, textbookId, file.id, book.title, chunks);

    const linked = check(await ctx.supabase.rpc("link_textbook_chunks", { p_textbook_id: textbookId, min_similarity: LINK_THRESHOLD }), "link passages") as {
      stone_id: string;
      chunk_count: number;
    }[];
    await invalidateLessons(
      ctx,
      linked.map((l) => l.stone_id),
    );
    await setFile({ state: "done", pages: pages.length, chunks: chunks.length });

    const updated = files.map((f) => (f.id === file.id ? { ...f, state: "done" as const, pages: pages.length, chunks: chunks.length } : f));
    const complete = isComplete(updated);
    return {
      part: { part, state: "done", pages: pages.length, chunks: chunks.length, error: null },
      passagesLinked: linked.reduce((n, l) => n + l.chunk_count, 0),
      stonesLinked: linked.length,
      complete,
      message: processMessage(book.title, part, book.pdf_parts, "done", chunks.length, complete),
    };
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Reading this part didn't work.";
    await setFile({ state: "failed", error: message }).catch((e) => console.error("Could not record part failure", e));
    throw error;
  }
}

async function savePassages(ctx: UserContext, textbookId: string, fileId: string, bookTitle: string, chunks: PdfChunk[]) {
  // A retry after a timeout starts the part clean.
  check(await ctx.supabase.from("textbook_chunks").delete().eq("file_id", fileId), "clear old passages");
  if (chunks.length === 0) return;
  const vectors = await embed(
    chunks.map((c) => passageEmbeddingText(c, bookTitle)),
    "document",
  );
  const rows = chunks.map((c, i) => ({
    user_id: ctx.user.id,
    textbook_id: textbookId,
    file_id: fileId,
    chunk_index: c.index,
    page_from: c.pageFrom,
    page_to: c.pageTo,
    heading: c.heading,
    content: c.content,
    embedding: toPgVector(vectors[i]),
  }));
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    check(await ctx.supabase.from("textbook_chunks").insert(rows.slice(i, i + INSERT_BATCH)), "save passages");
  }
}
