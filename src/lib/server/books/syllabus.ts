import type { CourseId } from "@/lib/blueprint-ids";
import { generateStructured, type ImageInput } from "../anthropic";
import { SyllabusSchema, type Syllabus, type Toc } from "../ai-schemas";
import { embed, toPgVector } from "../embeddings";
import { ApiError } from "../http";
import { addTwinPractice } from "../ingest/uworld";
import { relinkAndPractice } from "../path";
import { BLUEPRINT_GUIDE, LPN_SCOPE_RULES } from "../prompts";
import { check, type UserContext } from "../supabase";
import { findIsbn, lookupBook, normalizeIsbn, type BookMeta, type TocEntry } from "./lookup";
import { tocFromPhotos, tocFromText, tocFromWebSearch, tocToEntries } from "./toc";

export type BuildSyllabusInput = {
  title?: string | null;
  isbn?: string | null;
  tocText?: string | null;
  photos?: readonly ImageInput[];
  courseId?: CourseId | null;
};

export type BuildSyllabusResult =
  | {
      status: "created";
      textbookId: string;
      title: string;
      courseId: CourseId;
      tocSource: TocSource;
      counts: { units: number; modules: number; stones: number };
      linked: { notes: number; questions: number; practiceAdded: number };
    }
  | { status: "duplicate"; textbookId: string; title: string }
  | { status: "needs_toc_photo"; book: BookMeta | null };

type TocSource = "openlibrary" | "vision_ocr" | "web_search" | "manual";

const MIN_CHAPTERS = 3;
const MAX_STONES_PER_MODULE = 5;

// ---------------------------------------------------------------------------
// Syllabus design
// ---------------------------------------------------------------------------

const SYLLABUS_SYSTEM = `You turn a nursing textbook's chapter list into a Duolingo-style learning path for an LPN/LVN student preparing for the NCLEX-PN and HESI PN Exit exams.

Path shape:
- Units follow the book's own units or parts. If the book has none, group chapters into 3 to 8 sensible units.
- Each chapter becomes one module, in the book's order, keeping its chapter number.
- Each module has 2 to 4 stepping stones (1 for very short chapters). A stepping stone is one bite-size, testable concept a student can learn in about 5 minutes.
- Stone titles are six words or fewer, in plain language. Summaries are one sentence a 10-year-old could follow.
- key_topics lists 2 to 5 specific terms the stone covers (drug names, signs, procedures).
- Tag every stone with 1 or 2 NCLEX-PN client needs and the one HESI domain it best fits, with relevance from 0 to 1.
- Skip front and back matter. Keep non-clinical chapters (legal, ethics, communication, leadership): they are tested too.
- Choose the course the book belongs to.

Frame every stone the way an LPN practices.
${LPN_SCOPE_RULES}

${BLUEPRINT_GUIDE}`;

function describeToc(meta: BookMeta, chapters: readonly TocEntry[]): string {
  const lines = [`Book: ${meta.title}${meta.edition ? ` (${meta.edition} edition)` : ""}${meta.authors.length ? ` by ${meta.authors.join(", ")}` : ""}`, ""];
  let unit = "";
  for (const chapter of chapters) {
    if (chapter.unitTitle && chapter.unitTitle !== unit) {
      unit = chapter.unitTitle;
      lines.push(`## ${unit}`);
    }
    lines.push(`- Chapter ${chapter.number || "?"}: ${chapter.title}`);
    for (const heading of chapter.subheadings.slice(0, 12)) lines.push(`    - ${heading}`);
  }
  return lines.join("\n");
}

export async function designSyllabus(meta: BookMeta, chapters: readonly TocEntry[], courseHint: CourseId | null): Promise<Syllabus> {
  const syllabus = await generateStructured({
    what: "design-syllabus",
    schema: SyllabusSchema,
    system: SYLLABUS_SYSTEM,
    effort: "high",
    maxTokens: 64000,
    content: `${describeToc(meta, chapters)}\n\n${
      courseHint ? `The student filed this under the "${courseHint}" course.` : "Pick the course from the chapter list."
    } Build the learning path for all ${chapters.length} chapters.`,
  });
  return tidySyllabus(syllabus, courseHint);
}

// Enforces the limits structured outputs can't: no empty levels, stone caps, clean tags.
export function tidySyllabus(syllabus: Syllabus, courseHint: CourseId | null): Syllabus {
  const units = syllabus.units
    .map((unit) => ({
      title: unit.title.trim() || "Unit",
      modules: unit.modules
        .map((module) => ({
          chapter_number: module.chapter_number.trim(),
          title: module.title.trim(),
          stones: module.stones
            .filter((stone) => stone.title.trim())
            .slice(0, MAX_STONES_PER_MODULE)
            .map((stone) => {
              const seen = new Set<string>();
              const tags = stone.tags
                .filter((tag) => {
                  const key = `${tag.client_need_id}/${tag.hesi_domain_id}`;
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                })
                .slice(0, 3)
                .map((tag) => ({ ...tag, relevance: Math.min(1, Math.max(0, Number.isFinite(tag.relevance) ? tag.relevance : 1)) }));
              return {
                title: stone.title.trim().slice(0, 80),
                summary: stone.summary.trim(),
                key_topics: stone.key_topics.map((t) => t.trim()).filter(Boolean).slice(0, 8),
                tags,
              };
            }),
        }))
        .filter((module) => module.title && module.stones.length > 0),
    }))
    .filter((unit) => unit.modules.length > 0);

  if (units.length === 0) {
    throw new ApiError(502, "The learning path came out empty. Try again.", "empty_syllabus");
  }
  return { course_id: courseHint ?? syllabus.course_id, units };
}

// ---------------------------------------------------------------------------
// Finding the book and its chapters
// ---------------------------------------------------------------------------

async function findDuplicate(ctx: UserContext, meta: BookMeta): Promise<{ id: string; title: string } | null> {
  const query = ctx.supabase.from("textbooks").select("id, title, edition, isbn").eq("user_id", ctx.user.id);
  const rows = check(await (meta.isbn ? query.eq("isbn", meta.isbn) : query.ilike("title", meta.title.replace(/[\\%_]/g, "\\$&"))), "find duplicate") as {
    id: string;
    title: string;
    edition: string | null;
  }[];
  const match = rows.find((row) => meta.isbn || (row.edition ?? "") === (meta.edition ?? ""));
  return match ? { id: match.id, title: match.title } : null;
}

function bookFromToc(toc: Toc): BookMeta | null {
  if (!toc.book.title.trim()) return null;
  return {
    title: toc.book.title.trim(),
    authors: toc.book.authors.filter(Boolean),
    edition: toc.book.edition.trim(),
    isbn: normalizeIsbn(toc.book.isbn),
    coverUrl: null,
    publishedDate: null,
    source: "input",
  };
}

export async function buildSyllabus(ctx: UserContext, input: BuildSyllabusInput): Promise<BuildSyllabusResult> {
  const typedTitle = input.title?.trim() || null;
  let isbn = normalizeIsbn(input.isbn) ?? (typedTitle ? findIsbn(typedTitle) : null);
  let title = typedTitle && !normalizeIsbn(typedTitle) ? typedTitle.replace(/\bISBN[:\s]*[\dXx-]+/i, "").trim() || null : null;

  let chapters: TocEntry[] = [];
  let tocSource: TocSource | null = null;
  let photoBook: BookMeta | null = null;

  // 1. Photos of the table of contents (or the cover) are the most faithful source.
  if (input.photos?.length) {
    const toc = await tocFromPhotos(input.photos, null);
    photoBook = bookFromToc(toc);
    isbn ??= photoBook?.isbn ?? null;
    title ??= photoBook?.title ?? null;
    const fromPhotos = tocToEntries(toc);
    if (fromPhotos.length >= MIN_CHAPTERS) {
      chapters = fromPhotos;
      tocSource = "vision_ocr";
    }
  }

  // 2. Catalog lookup for the book's details, and OpenLibrary's chapter list when it has one.
  const lookup = isbn || title ? await lookupBook({ isbn, title }) : { meta: null, toc: [], tocSource: null };
  const meta: BookMeta | null =
    lookup.meta ?? photoBook ?? (title ? { title, authors: [], edition: "", isbn, coverUrl: null, publishedDate: null, source: "input" } : null);

  // 3. A chapter list the student pasted.
  if (!tocSource && input.tocText?.trim()) {
    const toc = await tocFromText(input.tocText, meta);
    const pasted = tocToEntries(toc);
    if (pasted.length >= MIN_CHAPTERS) {
      chapters = pasted;
      tocSource = "manual";
    }
  }

  if (!meta) {
    if (chapters.length) throw new ApiError(422, "What's the name of this book? Type its title and try again.", "need_title");
    throw new ApiError(422, "Type the book's title or ISBN, or snap a photo of its cover.", "need_book");
  }

  const duplicate = await findDuplicate(ctx, meta);
  if (duplicate) return { status: "duplicate", textbookId: duplicate.id, title: duplicate.title };

  if (!tocSource && lookup.tocSource === "openlibrary") {
    chapters = lookup.toc;
    tocSource = "openlibrary";
  }

  // 4. Last resort: look the chapter list up on the web.
  if (!tocSource) {
    const toc = await tocFromWebSearch(meta);
    if (toc) {
      chapters = tocToEntries(toc);
      tocSource = "web_search";
    }
  }

  if (!tocSource || chapters.length < MIN_CHAPTERS) {
    return { status: "needs_toc_photo", book: meta };
  }

  const syllabus = await designSyllabus(meta, chapters, input.courseId ?? null);
  const stones = syllabus.units.flatMap((u) => u.modules.flatMap((m) => m.stones.map((s) => ({ module: m.title, stone: s }))));
  const vectors = await embed(
    stones.map(({ module, stone }) => `${stone.title}\n${module}\n${stone.summary}\n${stone.key_topics.join(", ")}`),
    "document",
  );

  let v = 0;
  const payload = {
    units: syllabus.units.map((unit) => ({
      ...unit,
      modules: unit.modules.map((module) => ({
        ...module,
        stones: module.stones.map((stone) => ({ ...stone, embedding: toPgVector(vectors[v++]) })),
      })),
    })),
  };

  const textbookId = check(
    await ctx.supabase.rpc("create_syllabus", {
      textbook: {
        course_id: syllabus.course_id,
        title: meta.title,
        authors: meta.authors,
        isbn: meta.isbn ?? "",
        edition: meta.edition,
        cover_url: meta.coverUrl ?? "",
        toc_source: tocSource,
      },
      syllabus: payload,
    }),
    "create syllabus",
  ) as string;

  const linked = await relinkAndPractice(ctx, (c, id) => addTwinPractice(c, id));

  return {
    status: "created",
    textbookId,
    title: meta.title,
    courseId: syllabus.course_id,
    tocSource,
    counts: {
      units: syllabus.units.length,
      modules: syllabus.units.reduce((n, u) => n + u.modules.length, 0),
      stones: stones.length,
    },
    linked: { notes: linked.notesLinked, questions: linked.questionsLinked, practiceAdded: linked.practiceAdded },
  };
}
