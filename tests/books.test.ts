import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findIsbn,
  lookupBook,
  mapGoogleVolume,
  mapOpenLibraryToc,
  normalizeIsbn,
  parseEdition,
} from "@/lib/server/books/lookup";
import { tidySyllabus } from "@/lib/server/books/syllabus";
import type { Syllabus } from "@/lib/server/ai-schemas";

describe("ISBNs", () => {
  it("accepts valid ISBN-13s with or without dashes", () => {
    expect(normalizeIsbn("978-0-323-81205-4")).toBe("9780323812054");
    expect(normalizeIsbn("9780323812054")).toBe("9780323812054");
  });

  it("converts ISBN-10 to ISBN-13", () => {
    expect(normalizeIsbn("0-306-40615-2")).toBe("9780306406157");
    expect(normalizeIsbn("080442957X")).toBe("9780804429573");
  });

  it("rejects bad checksums and junk", () => {
    expect(normalizeIsbn("9780323812055")).toBeNull();
    expect(normalizeIsbn("12345")).toBeNull();
    expect(normalizeIsbn("")).toBeNull();
    expect(normalizeIsbn(null)).toBeNull();
  });

  it("finds an ISBN inside free text", () => {
    expect(findIsbn("Foundations of Nursing 9th ed ISBN 978-0-323-81205-4")).toBe("9780323812054");
    expect(findIsbn("Chapter 12 has 45 pages")).toBeNull();
  });
});

describe("parseEdition", () => {
  it("reads common edition spellings", () => {
    expect(parseEdition("Foundations of Nursing, 9th Edition")).toBe("9th");
    expect(parseEdition("Edition 3")).toBe("3rd");
    expect(parseEdition("Twelfth printing")).toBe("");
    expect(parseEdition("11th edition")).toBe("11th");
    expect(parseEdition("22nd Edition")).toBe("22nd");
  });
});

describe("mapGoogleVolume", () => {
  it("maps a volume and upgrades the cover to https", () => {
    const meta = mapGoogleVolume({
      volumeInfo: {
        title: "Foundations of Nursing",
        subtitle: "9th Edition",
        authors: ["Kim Cooper", "Kelly Gosnell"],
        publishedDate: "2022",
        industryIdentifiers: [
          { type: "ISBN_10", identifier: "0323812058" },
          { type: "ISBN_13", identifier: "9780323812054" },
        ],
        imageLinks: { thumbnail: "http://books.google.com/cover.jpg" },
      },
    });
    expect(meta).toEqual({
      title: "Foundations of Nursing",
      authors: ["Kim Cooper", "Kelly Gosnell"],
      edition: "9th",
      isbn: "9780323812054",
      coverUrl: "https://books.google.com/cover.jpg",
      publishedDate: "2022",
      source: "google_books",
    });
  });

  it("returns null without a title", () => {
    expect(mapGoogleVolume({})).toBeNull();
  });
});

describe("mapOpenLibraryToc", () => {
  it("handles unit > chapter > section nesting", () => {
    const toc = mapOpenLibraryToc([
      { level: 0, label: "", title: "Preface" },
      { level: 0, label: "Unit 1", title: "Foundations" },
      { level: 1, label: "1", title: "The Evolution of Nursing" },
      { level: 2, label: "", title: "Florence Nightingale" },
      { level: 1, label: "2", title: "Legal and Ethical Aspects" },
      { level: 0, label: "Unit 2", title: "Safety" },
      { level: 1, label: "3", title: "Infection Prevention and Control" },
      { level: 0, label: "", title: "Index" },
    ]);
    expect(toc).toEqual([
      { number: "1", title: "The Evolution of Nursing", unitTitle: "Unit 1 Foundations", subheadings: ["Florence Nightingale"] },
      { number: "2", title: "Legal and Ethical Aspects", unitTitle: "Unit 1 Foundations", subheadings: [] },
      { number: "3", title: "Infection Prevention and Control", unitTitle: "Unit 2 Safety", subheadings: [] },
    ]);
  });

  it("treats a flat list as chapters and strips 'Chapter N' prefixes", () => {
    const toc = mapOpenLibraryToc([
      { level: 0, title: "Chapter 1: Vital Signs" },
      { level: 0, title: "Chapter 2: Hygiene" },
      { level: 0, title: "Unit Three Mobility" },
      { level: 0, title: "3. Body Mechanics" },
    ]);
    expect(toc.map((c) => [c.number, c.title, c.unitTitle])).toEqual([
      ["1", "Vital Signs", ""],
      ["2", "Hygiene", ""],
      ["3", "Body Mechanics", "Unit Three Mobility"],
    ]);
  });

  it("treats a second level as section headings when the top level is chapters", () => {
    const toc = mapOpenLibraryToc([
      { level: 0, label: "1", title: "Fluids" },
      { level: 1, title: "Hypervolemia" },
      { level: 1, title: "Hypovolemia" },
      { level: 0, label: "2", title: "Electrolytes" },
    ]);
    expect(toc).toHaveLength(2);
    expect(toc[0].subheadings).toEqual(["Hypervolemia", "Hypovolemia"]);
  });
});

describe("lookupBook", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("merges Google Books details with OpenLibrary's chapter list", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://www.googleapis.com/books")) {
        expect(url).toContain("q=isbn%3A9780323812054");
        return Response.json({
          items: [{ volumeInfo: { title: "Foundations of Nursing", authors: ["Cooper"], industryIdentifiers: [{ type: "ISBN_13", identifier: "9780323812054" }] } }],
        });
      }
      if (url === "https://openlibrary.org/isbn/9780323812054.json") {
        return Response.json({
          title: "Foundations of nursing",
          edition_name: "9th edition",
          covers: [123],
          table_of_contents: [
            { level: 0, title: "Chapter 1: Vital Signs" },
            { level: 0, title: "Chapter 2: Hygiene" },
            { level: 0, title: "Chapter 3: Safety" },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupBook({ isbn: "978-0-323-81205-4" });
    expect(result.meta?.title).toBe("Foundations of Nursing");
    expect(result.meta?.edition).toBe("9th");
    expect(result.meta?.coverUrl).toBe("https://covers.openlibrary.org/b/id/123-L.jpg");
    expect(result.tocSource).toBe("openlibrary");
    expect(result.toc.map((c) => c.title)).toEqual(["Vital Signs", "Hygiene", "Safety"]);
  });

  it("never throws when both catalogs are down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const result = await lookupBook({ title: "Some Book" });
    expect(result).toEqual({ meta: null, toc: [], tocSource: null });
  });

  it("does not call OpenLibrary's edition endpoint without an ISBN", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("googleapis")) return new Response("rate limited", { status: 429 });
      if (url.includes("search.json")) return Response.json({ docs: [{ isbn: ["not-an-isbn"] }] });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await lookupBook({ title: "Unknown" });
    expect(result.meta).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("tidySyllabus", () => {
  const tag = { client_need_id: "pharm", hesi_domain_id: "pharmacology", relevance: 3 } as const;
  const stone = (title: string) => ({ title, summary: " s ", key_topics: [" a ", ""], tags: [tag, tag] });

  it("caps stones, drops empty levels, dedupes and clamps tags, and honors the course hint", () => {
    const raw: Syllabus = {
      course_id: "pharmacology",
      units: [
        {
          title: " Unit 1 ",
          modules: [
            { chapter_number: "1", title: "Big chapter", stones: ["a", "b", "c", "d", "e", "f", "g"].map(stone) },
            { chapter_number: "2", title: "Empty chapter", stones: [] },
          ],
        },
        { title: "Empty unit", modules: [] },
      ],
    };
    const tidy = tidySyllabus(raw, "med_surg");
    expect(tidy.course_id).toBe("med_surg");
    expect(tidy.units).toHaveLength(1);
    expect(tidy.units[0].title).toBe("Unit 1");
    expect(tidy.units[0].modules).toHaveLength(1);
    expect(tidy.units[0].modules[0].stones).toHaveLength(5);
    const first = tidy.units[0].modules[0].stones[0];
    expect(first.tags).toEqual([{ ...tag, relevance: 1 }]);
    expect(first.key_topics).toEqual(["a"]);
    expect(first.summary).toBe("s");
  });

  it("refuses an empty path", () => {
    expect(() => tidySyllabus({ course_id: "fundamentals", units: [] }, null)).toThrow(/empty/);
  });
});
