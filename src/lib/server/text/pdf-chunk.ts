// Turns the text of a textbook PDF, page by page, into passages that keep their heading and page range.
// PDF text has no markup, so headings are spotted from the shape of a line: "Chapter 12 ...",
// numbered sections like "12.3 Fluid Balance", and short all-capital lines.

export type PdfChunk = {
  index: number;
  heading: string;
  content: string;
  pageFrom: number;
  pageTo: number;
};

type ChunkOptions = { targetChars?: number; maxChars?: number };

const MAX_HEADING_CHARS = 90;
const CHAPTER = /^(chapter|unit|part|module)\s+(\d{1,3}|[ivxlc]{1,7})\b[\s:.–—-]*(.*)$/i;
const SECTION = /^(\d{1,2}(?:\.\d{1,2}){1,3})\.?\s+([A-Z][^]{2,80})$/;
const PAGE_NUMBER = /^(page\s+)?\d{1,4}$/i;
const BULLET = /^[•▪●•\-–*]\s*/;

type Heading = { level: number; text: string };

export function headingOf(line: string): Heading | null {
  const text = line.trim();
  if (!text || text.length > MAX_HEADING_CHARS) return null;
  const chapter = CHAPTER.exec(text);
  if (chapter) {
    const rest = chapter[3].trim();
    return { level: 1, text: `${chapter[1][0].toUpperCase()}${chapter[1].slice(1).toLowerCase()} ${chapter[2]}${rest ? ` ${rest}` : ""}` };
  }
  const section = SECTION.exec(text);
  if (section && !/[.;,]$/.test(section[2]) && !/\d\s*(mg|mL|kg|g|mcg|units?)\b/i.test(section[2])) {
    return { level: 1 + section[1].split(".").length, text: `${section[1]} ${section[2].trim()}` };
  }
  const letters = text.replace(/[^A-Za-z]/g, "");
  const words = text.split(/\s+/).length;
  if (letters.length >= 6 && words >= 2 && words <= 8 && text === text.toUpperCase() && /^[A-Z]/.test(text) && !/[.:]$/.test(text)) {
    return { level: 5, text: text.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) };
  }
  return null;
}

function normalizeLine(line: string): string {
  return line.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

// Lines printed on most pages (the book's running title, a chapter footer) are page furniture, not content.
export function repeatedLines(pages: readonly string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set(page.split("\n").map(normalizeLine).filter(Boolean));
    for (const line of seen) counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.4));
  return new Set([...counts].filter(([, n]) => pages.length >= 3 && n >= threshold).map(([line]) => line));
}

function pageLines(page: string, furniture: Set<string>): string[] {
  return page
    .replace(/\r\n?/g, "\n")
    .replace(/(\w)-\n(\w)/g, "$1$2")
    .split("\n")
    .map(normalizeLine)
    .filter((line) => line && !furniture.has(line) && !PAGE_NUMBER.test(line));
}

function splitSentences(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text]) {
    if (sentence.length > maxChars) {
      if (current.trim()) pieces.push(current.trim());
      current = "";
      for (let i = 0; i < sentence.length; i += maxChars) pieces.push(sentence.slice(i, i + maxChars).trim());
      continue;
    }
    if (current && current.length + sentence.length > maxChars) {
      pieces.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces.filter(Boolean);
}

// `firstPage` is the book page number of pages[0], so passages from later parts keep the real page numbers.
export function chunkPdfPages(pages: readonly string[], firstPage = 1, options: ChunkOptions = {}): PdfChunk[] {
  const targetChars = options.targetChars ?? 1400;
  const maxChars = options.maxChars ?? 2200;
  const furniture = repeatedLines(pages);

  const chunks: PdfChunk[] = [];
  const stack: Heading[] = [];
  let body = "";
  let pageFrom = 0;
  let pageTo = 0;

  const headingText = () => stack.map((h) => h.text).join(" > ");
  const flush = () => {
    const content = body.trim();
    if (content) {
      for (const piece of splitSentences(content, maxChars)) {
        chunks.push({ index: chunks.length, heading: headingText(), content: piece, pageFrom, pageTo });
      }
    }
    body = "";
    pageFrom = 0;
  };

  pages.forEach((page, i) => {
    const pageNumber = firstPage + i;
    for (const line of pageLines(page, furniture)) {
      const heading = headingOf(line);
      if (heading) {
        flush();
        while (stack.length && stack.at(-1)!.level >= heading.level) stack.pop();
        stack.push(heading);
        continue;
      }
      if (!pageFrom) pageFrom = pageNumber;
      pageTo = pageNumber;
      const joiner = !body ? "" : BULLET.test(line) || /[.:;!?]$/.test(body) ? "\n" : " ";
      body += joiner + line;
      // Close a passage at a sentence end once it is long enough.
      if (body.length >= targetChars && /[.!?]["')\]]?$/.test(line)) flush();
    }
  });
  flush();
  return chunks;
}

// The text that gets embedded for a passage: book title and heading give a short passage its topic.
export function passageEmbeddingText(chunk: Pick<PdfChunk, "heading" | "content">, bookTitle: string): string {
  return [bookTitle, chunk.heading, chunk.content].filter(Boolean).join("\n");
}

export function pageLabel(from: number, to: number): string {
  return from === to ? `p. ${from}` : `pp. ${from}-${to}`;
}
