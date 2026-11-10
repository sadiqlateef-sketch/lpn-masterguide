import { describe, expect, it } from "vitest";
import { askPrompt, citedSources, cleanQuestion, pickSources, type AskSourceText } from "@/lib/server/ask";
import { cleanQuery, snippetFor, toResults } from "@/lib/server/search";

const source = (id: string, label: string, text = "text", kind: "note" | "textbook" = "textbook"): AskSourceText => ({ id, kind, label, text });

describe("Ask about this card", () => {
  it("tidies the question and refuses empty or long ones", () => {
    expect(cleanQuestion("  why   hold it? ")).toBe("why hold it?");
    expect(() => cleanQuestion(" ")).toThrow(/Type a question/);
    expect(() => cleanQuestion("x".repeat(501))).toThrow(/too long/);
  });

  it("drops repeated sources and stops before the prompt gets too big", () => {
    const picked = pickSources([source("1", "A"), source("1", "A again"), source("2", "B", "y".repeat(14000)), source("3", "C")]);
    expect(picked.map((s) => s.id)).toEqual(["1", "3"]);
  });

  it("keeps only citations that point at a real source, each label once", () => {
    const sources = [source("1", "Pharm, p. 4"), source("2", "Pharm, p. 4"), source("3", "Pharm notebook: Cardiac", "t", "note")];
    expect(citedSources({ cited: [2, 0, 1, 7, -1, 0.5, 2] }, sources)).toEqual([
      { kind: "note", label: "Pharm notebook: Cardiac" },
      { kind: "textbook", label: "Pharm, p. 4" },
    ]);
    expect(citedSources({ cited: [] }, sources)).toEqual([]);
  });

  it("numbers the sources in the prompt and says when there are none", () => {
    expect(askPrompt({ stoneTitle: "Digoxin", card: "Card", question: "Why?", sources: [source("1", "Pharm, p. 4", "Check the pulse.")] })).toContain(
      "[0] Pharm, p. 4\nCheck the pulse.",
    );
    expect(askPrompt({ stoneTitle: "Digoxin", card: "Card", question: "Why?", sources: [] })).toContain("No sources");
  });
});

describe("search", () => {
  it("needs two letters and refuses long searches", () => {
    expect(cleanQuery("  dig  ")).toBe("dig");
    expect(() => cleanQuery("d")).toThrow(/two letters/);
    expect(() => cleanQuery(null)).toThrow(/two letters/);
    expect(() => cleanQuery("x".repeat(121))).toThrow(/too long/);
  });

  it("makes a short snippet near the search word", () => {
    expect(snippetFor("## **Short** note", "note")).toBe("Short note");
    const long = `${"Filler words here. ".repeat(20)}Digoxin toxicity shows as yellow halos. ${"More text after. ".repeat(20)}`;
    const snip = snippetFor(long, "digoxin");
    expect(snip.startsWith("...")).toBe(true);
    expect(snip).toContain("Digoxin toxicity");
    expect(snip.length).toBeLessThanOrEqual(206);
  });

  it("attaches each result's stone", () => {
    const results = toResults(
      [
        { kind: "textbook", id: "t1", stone_id: "s1", title: "Pharm, p. 4", snippet: "Check the pulse.", score: 0.8 },
        { kind: "note", id: "n1", stone_id: null, title: "My notes", snippet: "Loose note", score: 0.6 },
      ],
      [{ id: "s1", title: "Digoxin", status: "locked" }],
      "pulse",
    );
    expect(results[0]).toEqual({ kind: "textbook", id: "t1", stone: { id: "s1", title: "Digoxin", status: "locked" }, title: "Pharm, p. 4", snippet: "Check the pulse." });
    expect(results[1].stone).toBeNull();
  });
});
