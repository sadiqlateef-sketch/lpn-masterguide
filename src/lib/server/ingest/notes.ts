import { createHash } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import type { NoteSourceView } from "@/lib/api-types";
import { generateStructured, imageBlocks, pdfBlock, type ImageInput } from "../anthropic";
import { NotePearlsSchema, TranscriptionSchema } from "../ai-schemas";
import { embed, toPgVector } from "../embeddings";
import { ApiError } from "../http";
import { invalidateLessons } from "../path";
import { check, type UserContext } from "../supabase";
import { chunkMarkdown, cleanText, embeddingText, type Chunk } from "../text/chunk";

export type NoteFile = { name: string; mediaType: string; bytes: Uint8Array };

type NoteSource = { title: string; text: string };

const MIN_TEXT_PER_PAGE = 200;
const PEARL_HINT = /\b(mnemonic|pearl|remember|exam tip|test tip|on the (exam|test|nclex|hesi)|priority|key point|must know|professor|always|never)\b|!!|⭐|★/i;
const INSERT_BATCH = 200;

const TRANSCRIBE_SYSTEM = `You turn a nursing student's study notes into clean markdown for their private study app.
Keep every fact, mnemonic, abbreviation and professor tip exactly. Use headings for topics and bullet lists where the notes use them.
Do not add facts that are not in the notes.`;

async function transcribePdf(file: NoteFile): Promise<string> {
  const { markdown } = await generateStructured({
    what: "transcribe-pdf",
    schema: TranscriptionSchema,
    system: TRANSCRIBE_SYSTEM,
    effort: "low",
    maxTokens: 64000,
    content: [pdfBlock(Buffer.from(file.bytes).toString("base64")), { type: "text", text: "Transcribe these notes into markdown." }],
  });
  return markdown;
}

export async function transcribeNotePhotos(images: readonly ImageInput[]): Promise<string> {
  const { markdown } = await generateStructured({
    what: "transcribe-photos",
    schema: TranscriptionSchema,
    system: TRANSCRIBE_SYSTEM,
    effort: "low",
    maxTokens: 32000,
    content: [...imageBlocks(images), { type: "text", text: "Transcribe these pages of notes into markdown, in order." }],
  });
  return markdown;
}

async function pdfText(file: NoteFile): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(file.bytes));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    if (text.trim().length >= MIN_TEXT_PER_PAGE * Math.max(1, Math.min(totalPages, 5))) return text;
  } catch (error) {
    console.warn(`Could not read text layer of ${file.name}`, error);
  }
  // Scanned or image-only PDF: let Claude read the pages.
  return transcribePdf(file);
}

function titleFromName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "My notes";
}

export async function readNoteFile(file: NoteFile): Promise<NoteSource> {
  const text = file.mediaType === "application/pdf" ? await pdfText(file) : new TextDecoder().decode(file.bytes);
  return { title: titleFromName(file.name), text };
}

async function findPearls(title: string, chunks: Chunk[]): Promise<{ title: string; pearls: Set<number> }> {
  const pearls = new Set(chunks.filter((c) => PEARL_HINT.test(c.content)).map((c) => c.index));
  const preview = chunks.map((c) => `[${c.index}] ${c.heading ? `${c.heading}: ` : ""}${c.content.slice(0, 400)}`).join("\n\n");
  try {
    const result = await generateStructured({
      what: "note-pearls",
      schema: NotePearlsSchema,
      system:
        "You label a nursing student's study note chunks. Exam pearls are mnemonics, professor tips, 'this will be on the exam' notes, priority rules, and early-versus-late sign contrasts.",
      effort: "low",
      maxTokens: 8000,
      content: `Notes titled "${title}", split into numbered chunks:\n\n${preview}\n\nGive a short title for these notes and list the chunk indexes that hold exam pearls.`,
    });
    for (const i of result.pearl_chunk_indexes) if (Number.isInteger(i) && i >= 0 && i < chunks.length) pearls.add(i);
    return { title: result.title.trim() || title, pearls };
  } catch (error) {
    // Pearl labels are a bonus; the keyword pass above still marks the obvious ones.
    console.warn("Pearl labelling failed", error);
    return { title, pearls };
  }
}

export type NotesIngestResult = {
  sources: { id: string; title: string; chunks: number; pearls: number }[];
  chunksSaved: number;
  chunksLinked: number;
  stonesLinked: number;
  // Folder sync: the same file was sent again with no changes, so nothing was redone.
  unchanged: boolean;
  // Folder sync: an older copy of this file was replaced.
  replaced: boolean;
};

const MAX_EXTERNAL_KEY = 500;

export function contentHash(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeExternalKey(key: string | null | undefined): string | null {
  const clean = key?.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!clean) return null;
  if (clean.length > MAX_EXTERNAL_KEY) throw new ApiError(400, "That file path is too long.", "bad_external_key");
  return clean;
}

async function saveSource(
  ctx: UserContext,
  source: NoteSource,
  ingestItemId: string,
  notebookId: string,
  contentHashValue: string | null = null,
) {
  const chunks = chunkMarkdown(source.text);
  if (chunks.length === 0) return null;

  const { title, pearls } = await findPearls(source.title, chunks);
  const vectors = await embed(chunks.map((c) => embeddingText(c, title)), "document");

  const row = check(
    await ctx.supabase
      .from("note_sources")
      .insert({ user_id: ctx.user.id, ingest_item_id: ingestItemId, notebook_id: notebookId, title, content_hash: contentHashValue })
      .select("id")
      .single(),
    "save note source",
  ) as { id: string };

  const chunkRows = chunks.map((chunk, i) => ({
    user_id: ctx.user.id,
    source_id: row.id,
    chunk_index: chunk.index,
    content: chunk.heading ? `**${chunk.heading}**\n${chunk.content}` : chunk.content,
    is_exam_pearl: pearls.has(chunk.index),
    embedding: toPgVector(vectors[i]),
  }));
  for (let i = 0; i < chunkRows.length; i += INSERT_BATCH) {
    check(await ctx.supabase.from("note_chunks").insert(chunkRows.slice(i, i + INSERT_BATCH)), "save note chunks");
  }
  return { id: row.id, title, chunks: chunks.length, pearls: pearls.size };
}

// Stones whose notes come from these sources; their lessons must rebuild when the notes go.
async function stonesUsingSources(ctx: UserContext, sourceIds: readonly string[]): Promise<string[]> {
  if (sourceIds.length === 0) return [];
  const rows = check(
    await ctx.supabase.from("note_chunks").select("stone_id").in("source_id", sourceIds).not("stone_id", "is", null),
    "find note stones",
  ) as { stone_id: string }[];
  return [...new Set(rows.map((r) => r.stone_id))];
}

async function removeSources(ctx: UserContext, sourceIds: readonly string[]): Promise<string[]> {
  const stones = await stonesUsingSources(ctx, sourceIds);
  check(await ctx.supabase.from("note_sources").delete().in("id", sourceIds), "remove notes");
  await invalidateLessons(ctx, stones);
  return stones;
}

export async function listNoteSources(ctx: UserContext): Promise<NoteSourceView[]> {
  const rows = check(
    await ctx.supabase
      .from("note_sources")
      .select("id, title, notebook_id, external_key, content_hash, created_at, note_chunks(count)")
      .order("created_at", { ascending: false }),
    "list notes",
  ) as {
    id: string;
    title: string;
    notebook_id: string | null;
    external_key: string | null;
    content_hash: string | null;
    created_at: string;
    note_chunks: { count: number }[];
  }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    notebookId: r.notebook_id,
    externalKey: r.external_key,
    contentHash: r.content_hash,
    chunks: r.note_chunks[0]?.count ?? 0,
    createdAt: r.created_at,
  }));
}

export async function deleteNoteSource(ctx: UserContext, sourceId: string): Promise<{ deleted: true; lessonsRefreshed: number }> {
  const found = check(await ctx.supabase.from("note_sources").select("id").eq("id", sourceId).maybeSingle(), "find notes");
  if (!found) throw new ApiError(404, "Those notes aren't here anymore.", "not_found");
  const stones = await removeSources(ctx, [sourceId]);
  return { deleted: true, lessonsRefreshed: stones.length };
}

export async function ingestNotes(
  ctx: UserContext,
  input: {
    files: readonly NoteFile[];
    images: readonly ImageInput[];
    text: string | null;
    ingestItemId: string;
    notebookId: string;
    externalKey?: string | null;
  },
): Promise<NotesIngestResult> {
  const externalKey = normalizeExternalKey(input.externalKey);
  let previous: { id: string; content_hash: string | null } | null = null;
  let hash: string | null = null;
  if (externalKey) {
    const parts = input.files.length + (input.images.length ? 1 : 0) + (input.text?.trim() ? 1 : 0);
    if (parts !== 1) throw new ApiError(400, "Sync one file at a time.", "one_file_per_key");
    hash = input.files[0] ? contentHash(input.files[0].bytes) : input.images.length ? contentHash(input.images.map((i) => i.base64).join("")) : contentHash(input.text ?? "");
    previous = check(
      await ctx.supabase.from("note_sources").select("id, content_hash").eq("external_key", externalKey).maybeSingle(),
      "find synced notes",
    ) as { id: string; content_hash: string | null } | null;
    if (previous && previous.content_hash === hash) {
      return { sources: [], chunksSaved: 0, chunksLinked: 0, stonesLinked: 0, unchanged: true, replaced: false };
    }
  }

  const sources: NoteSource[] = [];
  for (const file of input.files) sources.push(await readNoteFile(file));
  if (input.images.length) sources.push({ title: "Photographed notes", text: await transcribeNotePhotos(input.images) });
  if (input.text?.trim()) {
    const firstHeading = /^#{1,6}\s+(.+)$/m.exec(input.text)?.[1];
    sources.push({ title: firstHeading?.trim() || "Pasted notes", text: input.text });
  }

  const usable = sources.filter((s) => cleanText(s.text).length > 0);
  if (usable.length === 0) {
    throw new ApiError(422, "There was no text in those notes to save.", "empty_notes");
  }

  const saved = [];
  for (const source of usable) {
    const result = await saveSource(ctx, source, input.ingestItemId, input.notebookId, hash);
    if (result) saved.push(result);
  }

  // The new copy is saved before the old one is removed, so a failed update never loses notes.
  if (externalKey && saved[0]) {
    if (previous) await removeSources(ctx, [previous.id]);
    check(await ctx.supabase.from("note_sources").update({ external_key: externalKey }).eq("id", saved[0].id), "label synced notes");
  }

  const linked = check(await ctx.supabase.rpc("link_unlinked_note_chunks", { min_similarity: 0.35 }), "link notes") as {
    stone_id: string;
    chunk_count: number;
  }[];
  await invalidateLessons(
    ctx,
    linked.map((l) => l.stone_id),
  );

  return {
    sources: saved,
    chunksSaved: saved.reduce((sum, s) => sum + s.chunks, 0),
    chunksLinked: linked.reduce((sum, l) => sum + l.chunk_count, 0),
    stonesLinked: linked.length,
    unchanged: false,
    replaced: Boolean(externalKey && previous),
  };
}
