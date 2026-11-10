import { generateStructured, imageBlocks, researchWithWebSearch, type ImageInput } from "../anthropic";
import { TocSchema, type Toc } from "../ai-schemas";
import type { BookMeta, TocEntry } from "./lookup";

const TOC_SYSTEM = `You transcribe nursing textbook tables of contents for a study app.
Copy chapter numbers, chapter titles, unit or part titles, and section headings exactly as printed. Never invent chapters.
Skip front and back matter (preface, contributors, index, glossary, appendices, answer keys).
Book details you cannot see stay as empty strings.`;

export function tocToEntries(toc: Toc): TocEntry[] {
  return toc.chapters
    .filter((c) => c.title.trim())
    .map((c) => ({ number: c.number.trim(), title: c.title.trim(), unitTitle: c.unit_title.trim(), subheadings: c.subheadings.map((h) => h.trim()).filter(Boolean) }));
}

// Reads chapter lists from photos of the printed table of contents (any number of pages, in order).
export async function tocFromPhotos(images: readonly ImageInput[], hint: BookMeta | null): Promise<Toc> {
  return generateStructured({
    what: "toc-from-photos",
    schema: TocSchema,
    system: TOC_SYSTEM,
    effort: "medium",
    content: [
      ...imageBlocks(images),
      {
        type: "text",
        text: `These ${images.length} photo(s) show a textbook's table of contents, or its cover. Transcribe every chapter in order.${
          hint ? ` The book is probably "${hint.title}"${hint.edition ? `, ${hint.edition} edition` : ""}.` : ""
        } If a photo shows only the cover, return the book details and an empty chapter list.`,
      },
    ],
  });
}

// Reads a chapter list the student pasted as text.
export async function tocFromText(text: string, hint: BookMeta | null): Promise<Toc> {
  return generateStructured({
    what: "toc-from-text",
    schema: TocSchema,
    system: TOC_SYSTEM,
    effort: "low",
    content: `Here is a textbook's table of contents, pasted by a student.${hint ? ` The book is "${hint.title}".` : ""}\n\n<toc>\n${text}\n</toc>`,
  });
}

const RESEARCH_SYSTEM = `You find the official table of contents of nursing textbooks.
Prefer the publisher's page (Elsevier, Wolters Kluwer, F.A. Davis, Pearson) or a major retailer listing for the exact edition.
Report only chapters you found on a page. If you cannot find this edition's chapter list, reply with exactly NOT_FOUND.`;

// Looks up the chapter list on the web when the catalogs don't have one. Returns null if nothing reliable turns up.
export async function tocFromWebSearch(meta: BookMeta): Promise<Toc | null> {
  const described = [
    `"${meta.title}"`,
    meta.edition && `${meta.edition} edition`,
    meta.authors.length && `by ${meta.authors.join(", ")}`,
    meta.isbn && `ISBN ${meta.isbn}`,
  ]
    .filter(Boolean)
    .join(", ");

  const found = await researchWithWebSearch({
    what: "toc-web-search",
    system: RESEARCH_SYSTEM,
    prompt: `Find the table of contents for the nursing textbook ${described}. List every chapter as "Chapter N: Title", grouped under its unit or part heading if the book has them.`,
    effort: "medium",
  });
  if (!found || /NOT_FOUND/.test(found)) return null;

  const toc = await tocFromText(found, meta);
  return toc.chapters.length >= 3 ? toc : null;
}
