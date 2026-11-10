import { env } from "../env";

export type BookMeta = {
  title: string;
  authors: string[];
  edition: string;
  isbn: string | null;
  coverUrl: string | null;
  publishedDate: string | null;
  source: "google_books" | "openlibrary" | "input";
};

export type TocEntry = {
  number: string;
  title: string;
  unitTitle: string;
  subheadings: string[];
};

export type LookupResult = {
  meta: BookMeta | null;
  toc: TocEntry[];
  tocSource: "openlibrary" | null;
};

const TIMEOUT_MS = 8000;
const USER_AGENT = "LPNMasterGuide/0.2 (student study app)";

// ---------------------------------------------------------------------------
// ISBN helpers
// ---------------------------------------------------------------------------

function isbn10Valid(isbn: string): boolean {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = isbn[i];
    const value = c === "X" && i === 9 ? 10 : Number(c);
    if (Number.isNaN(value)) return false;
    sum += value * (10 - i);
  }
  return sum % 11 === 0;
}

function isbn13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

function isbn13Valid(isbn: string): boolean {
  return /^\d{13}$/.test(isbn) && isbn13CheckDigit(isbn.slice(0, 12)) === Number(isbn[12]);
}

// Returns a valid ISBN-13 (converting ISBN-10), or null when the input isn't a valid ISBN.
export function normalizeIsbn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/[^0-9X]/g, "");
  if (compact.length === 13) return isbn13Valid(compact) ? compact : null;
  if (compact.length === 10 && /^\d{9}[\dX]$/.test(compact) && isbn10Valid(compact)) {
    const first12 = `978${compact.slice(0, 9)}`;
    return `${first12}${isbn13CheckDigit(first12)}`;
  }
  return null;
}

// Finds an ISBN anywhere in free text, e.g. "Foundations of Nursing ISBN 978-0-323-81205-4".
export function findIsbn(text: string): string | null {
  const candidates = text.match(/(?:97[89][\s-]?)?\d[\d\s-]{7,15}[\dXx]/g) ?? [];
  for (const candidate of candidates) {
    const isbn = normalizeIsbn(candidate);
    if (isbn) return isbn;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Google Books
// ---------------------------------------------------------------------------

type GoogleVolume = {
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publishedDate?: string;
    industryIdentifiers?: { type: string; identifier: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
};

export function parseEdition(text: string): string {
  const match = /(\d+)(?:st|nd|rd|th)\s+edition/i.exec(text) ?? /edition\s+(\d+)/i.exec(text);
  if (!match) return "";
  const n = Number(match[1]);
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

export function mapGoogleVolume(volume: GoogleVolume): BookMeta | null {
  const info = volume.volumeInfo;
  if (!info?.title) return null;
  const ids = info.industryIdentifiers ?? [];
  const isbn =
    normalizeIsbn(ids.find((id) => id.type === "ISBN_13")?.identifier) ??
    normalizeIsbn(ids.find((id) => id.type === "ISBN_10")?.identifier);
  const fullTitle = info.subtitle ? `${info.title}: ${info.subtitle}` : info.title;
  const cover = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null;
  return {
    title: info.title,
    authors: info.authors ?? [],
    edition: parseEdition(fullTitle),
    isbn,
    coverUrl: cover ? cover.replace(/^http:/, "https:") : null,
    publishedDate: info.publishedDate ?? null,
    source: "google_books",
  };
}

export async function lookupGoogleBooks(query: { isbn?: string | null; title?: string | null }): Promise<BookMeta | null> {
  const q = query.isbn ? `isbn:${query.isbn}` : query.title ? `intitle:${query.title}` : null;
  if (!q) return null;
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", "5");
  url.searchParams.set("printType", "books");
  const key = env.googleBooksApiKey();
  if (key) url.searchParams.set("key", key);

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      console.warn(`Google Books lookup returned ${response.status}`);
      return null;
    }
    const body = (await response.json()) as { items?: GoogleVolume[] };
    const books = (body.items ?? []).map(mapGoogleVolume).filter((b): b is BookMeta => b !== null);
    // Prefer a result that carries an ISBN, since that unlocks the OpenLibrary chapter list.
    return books.find((b) => b.isbn) ?? books[0] ?? null;
  } catch (error) {
    console.warn("Google Books lookup failed", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// OpenLibrary
// ---------------------------------------------------------------------------

type OpenLibraryTocItem = { level?: number; label?: string; title?: string };
type OpenLibraryEdition = {
  title?: string;
  subtitle?: string;
  edition_name?: string;
  by_statement?: string;
  publish_date?: string;
  covers?: number[];
  table_of_contents?: OpenLibraryTocItem[];
};

const UNIT_PATTERN = /^(unit|part|section)\s+([\dIVXL]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
const NON_CHAPTER = /^(preface|foreword|acknowledg|contents|index|glossary|appendix|appendices|bibliography|references|answer key|about the author|dedication|reviewers|contributors|copyright|title page)/i;

// Turns OpenLibrary's flat, levelled TOC into chapters that remember their unit and section headings.
export function mapOpenLibraryToc(items: readonly OpenLibraryTocItem[]): TocEntry[] {
  const kept = items.filter((item) => {
    const title = (item.title ?? "").trim();
    return title && !NON_CHAPTER.test(title);
  });
  const levels = [...new Set(kept.map((i) => i.level ?? 0))].sort((a, b) => a - b);
  const looksLikeUnit = (item: OpenLibraryTocItem) => UNIT_PATTERN.test(`${item.label ?? ""} ${item.title ?? ""}`.trim());

  let unitLevel: number | null = null;
  let chapterLevel = levels[0] ?? 0;
  if (levels.length >= 3) {
    [unitLevel, chapterLevel] = levels;
  } else if (levels.length === 2 && kept.some((i) => (i.level ?? 0) === levels[0] && looksLikeUnit(i))) {
    [unitLevel, chapterLevel] = levels;
  }

  const entries: TocEntry[] = [];
  let unitTitle = "";
  for (const item of kept) {
    const level = item.level ?? 0;
    const title = (item.title ?? "").trim();
    const label = (item.label ?? "").trim();
    if (level === unitLevel || (level === chapterLevel && looksLikeUnit(item))) {
      unitTitle = label && !title.toLowerCase().startsWith(label.toLowerCase()) ? `${label} ${title}` : title;
      continue;
    }
    if (level > chapterLevel) {
      entries.at(-1)?.subheadings.push(title);
      continue;
    }
    const number = (/(\d+)/.exec(label) ?? /^(?:chapter\s+)?(\d+)[.:\s]/i.exec(title))?.[1] ?? "";
    const cleanTitle = title.replace(/^(?:chapter\s+)?\d+[.:\s]+/i, "").trim() || title;
    entries.push({ number, title: cleanTitle, unitTitle, subheadings: [] });
  }
  return entries;
}

async function fetchOpenLibrary<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch (error) {
    console.warn("OpenLibrary lookup failed", error);
    return null;
  }
}

export async function lookupOpenLibrary(query: { isbn?: string | null; title?: string | null }): Promise<{ meta: BookMeta; toc: TocEntry[] } | null> {
  let isbn = query.isbn ?? null;
  if (!isbn && query.title) {
    const search = await fetchOpenLibrary<{ docs?: { isbn?: string[] }[] }>(
      `https://openlibrary.org/search.json?title=${encodeURIComponent(query.title)}&fields=isbn&limit=5`,
    );
    isbn = search?.docs?.flatMap((d) => d.isbn ?? []).map(normalizeIsbn).find((i): i is string => i !== null) ?? null;
  }
  if (!isbn) return null;

  const edition = await fetchOpenLibrary<OpenLibraryEdition>(`https://openlibrary.org/isbn/${isbn}.json`);
  if (!edition?.title) return null;
  const cover = edition.covers?.find((c) => c > 0);
  return {
    meta: {
      title: edition.title,
      authors: edition.by_statement ? [edition.by_statement.replace(/^by\s+/i, "").replace(/\.$/, "")] : [],
      edition: parseEdition(edition.edition_name ?? "") || (edition.edition_name ?? ""),
      isbn,
      coverUrl: cover ? `https://covers.openlibrary.org/b/id/${cover}-L.jpg` : null,
      publishedDate: edition.publish_date ?? null,
      source: "openlibrary",
    },
    toc: mapOpenLibraryToc(edition.table_of_contents ?? []),
  };
}

// Looks the book up in both catalogs and merges what they know. Never throws.
export async function lookupBook(query: { isbn?: string | null; title?: string | null }): Promise<LookupResult> {
  const isbn = normalizeIsbn(query.isbn);
  const title = query.title?.trim() || null;

  const google = await lookupGoogleBooks({ isbn, title });
  const openLibrary = await lookupOpenLibrary({ isbn: isbn ?? google?.isbn ?? null, title: google?.title ?? title });

  const meta = google
    ? {
        ...google,
        isbn: google.isbn ?? openLibrary?.meta.isbn ?? isbn,
        edition: google.edition || openLibrary?.meta.edition || "",
        coverUrl: google.coverUrl ?? openLibrary?.meta.coverUrl ?? null,
        authors: google.authors.length ? google.authors : (openLibrary?.meta.authors ?? []),
      }
    : (openLibrary?.meta ?? null);

  const toc = openLibrary?.toc ?? [];
  return { meta, toc, tocSource: toc.length >= 3 ? "openlibrary" : null };
}
