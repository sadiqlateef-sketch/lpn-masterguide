import { describe, expect, it } from "vitest";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as schemas from "@/lib/server/ai-schemas";
import { classifyTextByRules, looksLikeToc } from "@/lib/server/ingest/classify";
import { bookMessage, notesMessage, questionMessage } from "@/lib/server/ingest/router";
import { validateTwin } from "@/lib/server/ingest/uworld";
import { chunkMarkdown, cleanText, embeddingText } from "@/lib/server/text/chunk";
import { resolveMediaType, sniffMatches, sortUploads } from "@/lib/server/uploads";

describe("classifyTextByRules", () => {
  it("spots an ISBN as a book", () => {
    expect(classifyTextByRules("ISBN 978-0-323-81205-4")?.route).toBe("book_title");
  });

  it("spots a short title as a book", () => {
    const decision = classifyTextByRules("Foundations of Nursing 9th edition Cooper");
    expect(decision).toMatchObject({ route: "book_title", bookTitle: "Foundations of Nursing 9th edition Cooper" });
  });

  it("spots a pasted table of contents", () => {
    const toc = ["Unit 1 Foundations", "Chapter 1 The Evolution of Nursing", "Chapter 2 Legal and Ethical", "Chapter 3 Documentation", "Chapter 4 Communication", "Chapter 5 Promoting Safety"].join("\n");
    expect(looksLikeToc(toc)).toBe(true);
    expect(classifyTextByRules(toc)?.route).toBe("toc_text");
  });

  it("spots a pasted UWorld question", () => {
    const text = `A client with heart failure is taking digoxin. Which finding should the nurse report?
A. Apical pulse 58/min
B. Potassium 4.2 mEq/L
C. Urine output 40 mL/hr
D. BP 128/76
Explanation: The correct answer is A. (Choice B) is a normal potassium level.
Educational objective: Hold digoxin and report an apical pulse under 60.`;
    expect(classifyTextByRules(text)?.route).toBe("uworld_text");
  });

  it("treats long prose as notes", () => {
    const notes = "Heart failure notes. ".repeat(40);
    expect(classifyTextByRules(notes)?.route).toBe("notebooklm_note");
  });

  it("leaves short ambiguous sentences to the AI", () => {
    expect(classifyTextByRules("What should I study for pharm? I keep missing insulin questions.")).toBeNull();
    expect(classifyTextByRules("hey how are you doing today?")).toBeNull();
    expect(classifyTextByRules("remember to buy milk")).toBeNull();
    expect(classifyTextByRules("Davis's Drug Guide for Nurses")?.route).toBe("book_title");
    expect(classifyTextByRules("Saunders Comprehensive Review")?.route).toBe("book_title");
    expect(classifyTextByRules("   ")).toBeNull();
  });
});

describe("chunkMarkdown", () => {
  it("keeps heading context and respects the target size", () => {
    const text = `# Cardiac\n\n## Digoxin\n\n${"Check apical pulse for one full minute. ".repeat(20)}\n\n${"Hold if under 60 and report. ".repeat(20)}\n\n## Heart failure\n\nDaily weights.`;
    const chunks = chunkMarkdown(text, { targetChars: 900, maxChars: 1200 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((c) => c.content.length <= 1200)).toBe(true);
    expect(chunks[0].heading).toBe("Cardiac > Digoxin");
    expect(chunks.at(-1)).toMatchObject({ heading: "Cardiac > Heart failure", content: "Daily weights." });
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("splits a single huge paragraph by sentence", () => {
    const chunks = chunkMarkdown("Sentence number one is here. ".repeat(200), { targetChars: 500, maxChars: 600 });
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.content.length <= 600)).toBe(true);
  });

  it("returns nothing for empty text", () => {
    expect(chunkMarkdown(" \n\n ")).toEqual([]);
  });

  it("cleans PDF artifacts", () => {
    expect(cleanText("hyper-\nkalemia\r\n\n\n\nnext line  \n")).toBe("hyperkalemia\n\nnext line");
  });

  it("builds embedding text from title, heading and body", () => {
    expect(embeddingText({ index: 0, heading: "Digoxin", content: "Hold if HR < 60" }, "Pharm notes")).toBe("Pharm notes\nDigoxin\nHold if HR < 60");
  });
});

describe("uploads", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const pdf = new TextEncoder().encode("%PDF-1.7 rest");

  it("falls back to file extensions for missing types", () => {
    expect(resolveMediaType("toc.JPG", "")).toBe("image/jpeg");
    expect(resolveMediaType("notes.md", "application/octet-stream")).toBe("text/markdown");
    expect(resolveMediaType("notes.md", "text/x-markdown")).toBe("text/markdown");
  });

  it("checks file signatures", () => {
    expect(sniffMatches("image/jpeg", jpeg)).toBe(true);
    expect(sniffMatches("image/png", jpeg)).toBe(false);
    expect(sniffMatches("application/pdf", pdf)).toBe(true);
  });

  it("sorts images and documents", () => {
    const parsed = sortUploads(
      [
        { name: "a.jpg", mediaType: "image/jpeg", bytes: jpeg },
        { name: "b.pdf", mediaType: "application/pdf", bytes: pdf },
      ],
      "  hello  ",
    );
    expect(parsed.text).toBe("hello");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].base64).toBe(Buffer.from(jpeg).toString("base64"));
    expect(parsed.documents).toHaveLength(1);
  });

  it("rejects HEIC, fakes, oversize files and empty input with friendly errors", () => {
    expect(() => sortUploads([{ name: "x.heic", mediaType: "image/heic", bytes: jpeg }], null)).toThrow(/HEIC/);
    expect(() => sortUploads([{ name: "x.png", mediaType: "image/png", bytes: jpeg }], null)).toThrow(/real image/);
    expect(() => sortUploads([{ name: "x.jpg", mediaType: "image/jpeg", bytes: new Uint8Array(6 * 1024 * 1024).fill(0xff) }], null)).toThrow(/under 5 MB/);
    expect(() => sortUploads([{ name: "x.exe", mediaType: "application/x-msdownload", bytes: jpeg }], null)).toThrow(/type I can read/);
    expect(() => sortUploads([], "  ")).toThrow(/Add a photo/);
    expect(sortUploads([], null, {}, { requireContent: false }).text).toBeNull();
  });
});

describe("validateTwin", () => {
  const options = ["A", "B", "C", "D", "E"].map((id) => ({ id, text: id }));
  const good: schemas.TwinPractice = {
    twin: { stem: "s", options: options.slice(0, 4), correct_option_ids: ["B"], rationale: "r", lpn_scope_note: "n", option_rationales: [] },
    bowtie: {
      scenario: "s",
      condition: { prompt: "p", options: options.slice(0, 4), correct_option_id: "A" },
      actions: { prompt: "p", options, correct_option_ids: ["A", "C"] },
      parameters: { prompt: "p", options, correct_option_ids: ["D", "E"] },
      rationale: "r",
    },
  };

  it("accepts consistent items", () => {
    expect(() => validateTwin(good)).not.toThrow();
  });

  it("rejects answers that point at missing options", () => {
    expect(() => validateTwin({ ...good, twin: { ...good.twin, correct_option_ids: ["Z"] } })).toThrow();
    expect(() => validateTwin({ ...good, bowtie: { ...good.bowtie, actions: { ...good.bowtie.actions, correct_option_ids: [] } } })).toThrow();
  });
});

describe("structured output schemas", () => {
  it("all convert to output formats the SDK accepts", () => {
    for (const schema of [
      schemas.ClassificationSchema,
      schemas.TocSchema,
      schemas.SyllabusSchema,
      schemas.StoneTagsSchema,
      schemas.UWorldSchema,
      schemas.TwinPracticeSchema,
      schemas.NotePearlsSchema,
      schemas.TranscriptionSchema,
    ]) {
      const format = betaZodOutputFormat(schema);
      expect(format.type).toBe("json_schema");
    }
  });
});

describe("student-facing messages", () => {
  it("describe each outcome in one plain sentence", () => {
    expect(
      bookMessage({
        status: "created",
        textbookId: "t",
        title: "Foundations of Nursing",
        courseId: "fundamentals",
        tocSource: "openlibrary",
        counts: { units: 4, modules: 40, stones: 1 },
        linked: { notes: 3, questions: 0, practiceAdded: 0 },
      }),
    ).toBe("Added Foundations of Nursing: 4 units and 1 stepping stone. Also linked 3 notes.");
    expect(bookMessage({ status: "needs_toc_photo", book: null })).toMatch(/table of contents/);
    expect(
      notesMessage({ sources: [{ id: "s", title: "t", chunks: 2, pearls: 1 }], chunksSaved: 2, chunksLinked: 0, stonesLinked: 0, unchanged: false, replaced: false }),
    ).toBe("Saved 2 note cards with 1 exam pearl. They'll link up when you add the matching school book.");
    expect(
      notesMessage({ sources: [{ id: "s", title: "t", chunks: 3, pearls: 0 }], chunksSaved: 3, chunksLinked: 3, stonesLinked: 2, unchanged: false, replaced: true }),
    ).toBe("Updated your notes. Saved 3 note cards. Linked to 2 stepping stones.");
    expect(notesMessage({ sources: [], chunksSaved: 0, chunksLinked: 0, stonesLinked: 0, unchanged: true, replaced: false })).toBe(
      "Those notes are already up to date.",
    );
    expect(
      questionMessage({ questionId: "q", topic: "digoxin", missed: true, coreTakeaway: "", stone: { id: "s", title: "Digoxin safety" }, practiceAdded: 2 }),
    ).toBe('Saved your digoxin question to "Digoxin safety". It\'s marked for review with 2 new practice questions.');
  });
});
