import { describe, expect, it } from "vitest";
import { chunkPdfPages, headingOf, pageLabel, passageEmbeddingText, repeatedLines } from "@/lib/server/text/pdf-chunk";

describe("headingOf", () => {
  it("spots chapters, numbered sections and all-capital headings", () => {
    expect(headingOf("CHAPTER 12 Fluid and Electrolytes")).toEqual({ level: 1, text: "Chapter 12 Fluid and Electrolytes" });
    expect(headingOf("Unit IV: Pharmacology")).toEqual({ level: 1, text: "Unit IV Pharmacology" });
    expect(headingOf("12.3 Hypokalemia")).toEqual({ level: 3, text: "12.3 Hypokalemia" });
    expect(headingOf("NURSING ACTIONS")).toEqual({ level: 5, text: "Nursing Actions" });
  });

  it("leaves ordinary lines, doses and sentences alone", () => {
    expect(headingOf("Give 12.5 mg by mouth daily.")).toBeNull();
    expect(headingOf("2.5 Give 10 mg twice daily")).toBeNull();
    expect(headingOf("The client reports nausea.")).toBeNull();
    expect(headingOf("BP")).toBeNull();
    expect(headingOf("NOTE: CHECK THE PULSE.")).toBeNull();
  });
});

describe("repeatedLines", () => {
  it("finds running headers on most pages but needs at least three pages", () => {
    const pages = ["Foundations of Nursing\nAlpha", "Foundations of Nursing\nBeta", "Foundations of Nursing\nGamma"];
    expect([...repeatedLines(pages)]).toEqual(["Foundations of Nursing"]);
    expect(repeatedLines(pages.slice(0, 2)).size).toBe(0);
  });
});

describe("chunkPdfPages", () => {
  const pages = [
    "Foundations\nCHAPTER 3 Infection Control\n3.1 Hand Hygiene\nWash hands for at least 20 sec-\nonds with soap and water.\n41",
    "Foundations\nUse alcohol rub when hands are not visibly soiled.\n3.2 Personal Protective Equipment\nPut on the gown first.\n42",
    "Foundations\nRemove gloves first when taking PPE off.\n43",
  ];

  it("keeps headings as breadcrumbs, real page numbers and joined words", () => {
    const chunks = chunkPdfPages(pages, 41);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      heading: "Chapter 3 Infection Control > 3.1 Hand Hygiene",
      pageFrom: 41,
      pageTo: 42,
    });
    expect(chunks[0].content).toContain("20 seconds with soap");
    expect(chunks[0].content).not.toContain("Foundations");
    expect(chunks[1]).toMatchObject({ heading: "Chapter 3 Infection Control > 3.2 Personal Protective Equipment", pageFrom: 42, pageTo: 43, index: 1 });
    expect(chunks.map((c) => c.content).join(" ")).not.toMatch(/\b4[123]\b/);
  });

  it("splits long sections at sentence ends and never exceeds the maximum", () => {
    const sentence = "The nurse collects data and reports changes to the RN. ";
    const chunks = chunkPdfPages([`SAFETY BASICS\n${sentence.repeat(80)}`], 1, { targetChars: 300, maxChars: 500 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(500);
      expect(c.heading).toBe("Safety Basics");
    }
  });

  it("returns nothing for empty pages", () => {
    expect(chunkPdfPages(["", "  "])).toEqual([]);
  });
});

describe("passage helpers", () => {
  it("labels pages and builds the embedding text", () => {
    expect(pageLabel(5, 5)).toBe("p. 5");
    expect(pageLabel(5, 7)).toBe("pp. 5-7");
    expect(passageEmbeddingText({ heading: "Ch 1", content: "Body" }, "Book")).toBe("Book\nCh 1\nBody");
    expect(passageEmbeddingText({ heading: "", content: "Body" }, "Book")).toBe("Book\nBody");
  });
});
