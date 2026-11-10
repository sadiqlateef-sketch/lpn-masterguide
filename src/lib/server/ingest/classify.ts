import { generateStructured, imageBlocks, type ImageInput } from "../anthropic";
import { ClassificationSchema, type Classification, type IngestKind } from "../ai-schemas";
import { findIsbn } from "../books/lookup";

// What the router does with an input. "toc_text" is a pasted chapter list; it is stored as a book_title ingest.
export type Route = IngestKind | "toc_text";

export type RouteDecision = {
  route: Route;
  bookTitle: string | null;
  isbn: string | null;
  decidedBy: "rules" | "ai";
};

const UWORLD_MARKERS = [
  /\bexplanation\b/i,
  /\beducational objective\b/i,
  /\bcorrect answer\b/i,
  /\b(choice|option)\s+[A-F]\b/i,
  /\(choice\s+[A-F]\)/i,
  /\bincorrect\b/i,
  /\bomitted\b/i,
  /\bquestion id\b/i,
  /^\s*[A-F][.)]\s+\S/m,
  /\bselect all that apply\b/i,
  /\buworld\b/i,
];

const TOC_LINE = /^\s*(?:(?:chapter|ch\.|unit|part)\s*[\dIVXL]+\b|\d{1,2}\s*[.:)\-]\s+[A-Z])/i;

export function looksLikeToc(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  const tocLines = lines.filter((l) => TOC_LINE.test(l)).length;
  return tocLines >= 5 && tocLines / lines.length >= 0.4;
}

const BOOK_WORDS = /\b(nursing|nurse|edition|ed\.|textbook|fundamentals|foundations|pharmacology|med[- ]?surg|medical[- ]surgical|maternal|maternity|pediatric|lpn|lvn|clinical|anatomy|physiology)\b/i;
const MINOR_WORDS = new Set(["a", "an", "and", "the", "of", "for", "in", "on", "to", "with", "by", "&"]);

// A short line reads as a book title when it names nursing-book words or is written in Title Case.
export function looksLikeBookTitle(text: string): boolean {
  if (/[?!]/.test(text) || /[.]\s+\S/.test(text)) return false;
  if (BOOK_WORDS.test(text)) return true;
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w) && !MINOR_WORDS.has(w.toLowerCase()));
  const capitalized = words.filter((w) => /^[A-Z]/.test(w)).length;
  return words.length >= 2 && capitalized / words.length >= 0.75;
}

// Cheap, predictable decisions for text that is obviously one thing. Returns null when unsure.
export function classifyTextByRules(raw: string): RouteDecision | null {
  const text = raw.trim();
  if (!text) return null;
  const isbn = findIsbn(text);
  const words = text.split(/\s+/).length;
  const lines = text.split("\n").filter((l) => l.trim()).length;
  const uworldScore = UWORLD_MARKERS.filter((m) => m.test(text)).length;

  if (isbn && text.length <= 200) return { route: "book_title", bookTitle: text, isbn, decidedBy: "rules" };
  if (looksLikeToc(text)) return { route: "toc_text", bookTitle: null, isbn, decidedBy: "rules" };
  if (uworldScore >= 3) return { route: "uworld_text", bookTitle: null, isbn: null, decidedBy: "rules" };
  if (lines === 1 && words <= 15 && text.length <= 120 && looksLikeBookTitle(text)) {
    return { route: "book_title", bookTitle: text, isbn: null, decidedBy: "rules" };
  }
  if (text.length >= 600 && uworldScore <= 1) return { route: "notebooklm_note", bookTitle: null, isbn: null, decidedBy: "rules" };
  return null;
}

const CLASSIFY_SYSTEM = `You sort what a nursing student adds to their study app into exactly one kind:
- book_title: a textbook title, author or ISBN typed as text
- book_cover: a photo of a textbook's cover or spine
- toc_photo: a photo of a printed table of contents page
- uworld_screenshot: a screenshot of a UWorld (or similar) practice question or its explanation
- uworld_text: a pasted practice question or rationale
- notebooklm_note: study notes, a study guide, lecture notes, or a photo of handwritten or printed notes
- unknown: none of these`;

function fromClassification(c: Classification): RouteDecision {
  return {
    route: c.kind,
    bookTitle: c.book_title_guess.trim() || null,
    isbn: findIsbn(c.isbn_guess) ?? null,
    decidedBy: "ai",
  };
}

export async function classifyText(text: string): Promise<RouteDecision> {
  const byRules = classifyTextByRules(text);
  if (byRules) return byRules;
  const result = await generateStructured({
    what: "classify-text",
    schema: ClassificationSchema,
    system: CLASSIFY_SYSTEM,
    effort: "low",
    maxTokens: 2000,
    content: `<added>\n${text.slice(0, 6000)}\n</added>`,
  });
  const decision = fromClassification(result);
  // Text can't be a photo; map photo kinds to their text equivalents.
  if (decision.route === "book_cover") decision.route = "book_title";
  if (decision.route === "toc_photo") decision.route = "toc_text";
  if (decision.route === "uworld_screenshot") decision.route = "uworld_text";
  return decision;
}

export async function classifyImages(images: readonly ImageInput[]): Promise<RouteDecision> {
  const result = await generateStructured({
    what: "classify-images",
    schema: ClassificationSchema,
    system: CLASSIFY_SYSTEM,
    effort: "low",
    maxTokens: 2000,
    content: [
      ...imageBlocks(images.slice(0, 4)),
      {
        type: "text",
        text: `${images.length} image(s) were added together. What kind are they? If a cover and table-of-contents pages are mixed, answer toc_photo.`,
      },
    ],
  });
  const decision = fromClassification(result);
  if (decision.route === "book_title") decision.route = "book_cover";
  if (decision.route === "uworld_text") decision.route = "uworld_screenshot";
  return decision;
}

export function ingestKindFor(route: Route): IngestKind {
  return route === "toc_text" ? "book_title" : route;
}
