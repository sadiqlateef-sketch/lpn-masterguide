import { describe, expect, it } from "vitest";
import { looksScanned, pageOffsetFor, processMessage, validatePartInput } from "@/lib/server/books/textbook-pdf";
import { halveRange, planSplit, TEXTBOOK_MAX_PARTS, TEXTBOOK_PART_TARGET_BYTES, textbookPartPath } from "@/lib/textbook-parts";

const MB = 1024 * 1024;

describe("planSplit", () => {
  it("keeps a small book whole", () => {
    expect(planSplit(5 * MB, 300)).toEqual([{ from: 1, to: 300 }]);
  });

  it("splits a big book into even page ranges that cover every page once", () => {
    const ranges = planSplit(95 * MB, 1001);
    expect(ranges).toHaveLength(Math.ceil((95 * MB) / TEXTBOOK_PART_TARGET_BYTES));
    expect(ranges[0].from).toBe(1);
    expect(ranges.at(-1)!.to).toBe(1001);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].from).toBe(ranges[i - 1].to + 1);
  });

  it("never makes more parts than pages or than the limit", () => {
    expect(planSplit(200 * MB, 3)).toHaveLength(3);
    expect(planSplit(10_000 * MB, 5000).length).toBeLessThanOrEqual(TEXTBOOK_MAX_PARTS);
    expect(planSplit(10 * MB, 0)).toEqual([]);
  });
});

describe("halveRange", () => {
  it("halves a range and refuses a single page", () => {
    expect(halveRange({ from: 1, to: 10 })).toEqual([{ from: 1, to: 5 }, { from: 6, to: 10 }]);
    expect(halveRange({ from: 4, to: 4 })).toBeNull();
  });
});

describe("textbook parts on the server", () => {
  it("stores each part in the student's own folder", () => {
    expect(textbookPartPath("u1", "b1", 2)).toBe("u1/textbooks/b1/part-2.pdf");
  });

  it("checks a part before it is recorded", () => {
    const ok = { part: 1, parts: 2, bytes: 10 * MB, contentHash: "a".repeat(64) };
    expect(() => validatePartInput(ok)).not.toThrow();
    expect(() => validatePartInput({ ...ok, part: 3 })).toThrow(/doesn't fit/);
    expect(() => validatePartInput({ ...ok, parts: 41, part: 1 })).toThrow(/at most 40/);
    expect(() => validatePartInput({ ...ok, bytes: 46 * MB })).toThrow(/too big/);
    expect(() => validatePartInput({ ...ok, contentHash: "nope" })).toThrow(/couldn't be checked/);
  });

  it("numbers pages across parts and needs the earlier parts read first", () => {
    const files = [
      { part_number: 1, pages: 120, state: "done" as const },
      { part_number: 2, pages: 80, state: "no_text" as const },
      { part_number: 3, pages: null, state: "uploaded" as const },
    ];
    expect(pageOffsetFor(files, 1)).toBe(0);
    expect(pageOffsetFor(files, 3)).toBe(200);
    expect(() => pageOffsetFor(files, 4)).toThrow(/Read part 3/);
  });

  it("treats pages with almost no text as scanned", () => {
    expect(looksScanned([])).toBe(true);
    expect(looksScanned(["", "12", " "])).toBe(true);
    expect(looksScanned(["The nurse collects data on the client. ".repeat(10)])).toBe(false);
  });

  it("says what happened to each part", () => {
    expect(processMessage("Foundations", 1, 3, "done", 40, false)).toBe("Read part 1 of 3 of Foundations: 40 passages.");
    expect(processMessage("Foundations", 3, 3, "done", 1, true)).toBe("Read part 3 of 3 of Foundations: 1 passage. The whole book is in, and your lessons will use it.");
    expect(processMessage("Foundations", 2, 3, "no_text", 0, false)).toMatch(/scanned pages/);
  });
});
