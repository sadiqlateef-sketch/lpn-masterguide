import { describe, expect, it } from "vitest";
import { decisionFor, settleCheck } from "@/lib/server/anki/check";
import { deckNameFrom, looksLikeZip } from "@/lib/server/anki/decks";
import { checkedQuotes, normalizeForQuote, quoteInSource, SourcePool, type NumberedSource } from "@/lib/server/anki/sources";
import { tidySuggestions } from "@/lib/server/anki/suggest";

const sources: NumberedSource[] = [
  {
    id: "p1",
    kind: "textbook",
    label: "Pharm Book, p. 212",
    text: "Protamine sulfate is the antidote for heparin.\nIt is given slowly IV, 1 mg per 100 units of heparin.",
  },
  { id: "n1", kind: "note", label: "Pharm notes: Week 3", text: "Check aPTT before each heparin dose and report values over 2.5 times normal." },
];
const card = { id: "c1", front: "Antidote for heparin?", back: "Vitamin K", stoneTitle: "Anticoagulants" };

const raw = (over: Partial<Parameters<typeof settleCheck>[0] & object>) => ({
  card: 0,
  verdict: "agrees" as const,
  confidence: 0.9,
  explanation: "The book names protamine sulfate.",
  corrected_front: "",
  corrected_back: "",
  quotes: [{ source: 0, quote: "Protamine sulfate is the antidote for heparin." }],
  ...over,
});

describe("quotes", () => {
  it("matches across line breaks, case and curly quotes", () => {
    expect(quoteInSource("protamine SULFATE is the antidote for heparin", sources[0].text)).toBe(true);
    expect(quoteInSource("It is given slowly IV, 1 mg per 100 units", sources[0].text)).toBe(true);
    expect(quoteInSource("“Check aPTT before each heparin dose”", sources[1].text)).toBe(true);
  });

  it("rejects made-up, tiny or misattributed quotes", () => {
    expect(quoteInSource("Vitamin K reverses heparin", sources[0].text)).toBe(false);
    expect(quoteInSource("IV", sources[0].text)).toBe(false);
    const { refs, bad } = checkedQuotes(
      [
        { source: 1, quote: "Protamine sulfate is the antidote for heparin" },
        { source: 0, quote: "Protamine sulfate is the antidote for heparin" },
        { source: 9, quote: "anything at all here" },
      ],
      sources,
    );
    expect(refs).toEqual([{ kind: "textbook", label: "Pharm Book, p. 212", quote: "Protamine sulfate is the antidote for heparin" }]);
    expect(bad).toBe(2);
  });

  it("normalizes without losing decimals", () => {
    expect(normalizeForQuote("2.5 times")).toBe("2.5 times");
  });

  it("caps a source pool and numbers each source once", () => {
    const pool = new SourcePool(120);
    expect(pool.add(sources[0])).toBe(0);
    expect(pool.add(sources[0])).toBe(0);
    expect(pool.add({ ...sources[1], text: "x".repeat(200) })).toBeNull();
  });
});

describe("settleCheck", () => {
  it("accepts a confident correction that quotes its source", () => {
    const s = settleCheck(
      raw({ verdict: "disagrees", corrected_front: "Antidote for heparin?", corrected_back: "Protamine sulfate" }),
      card,
      sources,
      false,
    );
    expect(s).toMatchObject({ verdict: "disagrees", sure: true, suggestion: { front: "Antidote for heparin?", back: "Protamine sulfate" } });
    expect(decisionFor(s)).toBe("pending");
  });

  it("sends a correction with a made-up quote for a second look, then drops it", () => {
    const bad = raw({ verdict: "disagrees", corrected_back: "Protamine", quotes: [{ source: 0, quote: "Vitamin K is never used for heparin" }] });
    expect(settleCheck(bad, card, sources, false).sure).toBe(false);
    const final = settleCheck(bad, card, sources, true);
    expect(final.verdict).toBe("no_source");
    expect(final.suggestion).toBeNull();
    expect(decisionFor(final)).toBe("none");
  });

  it("treats a correction that changes nothing as unsure", () => {
    const same = raw({ verdict: "outdated", corrected_front: card.front, corrected_back: card.back });
    expect(settleCheck(same, card, sources, false).sure).toBe(false);
    expect(settleCheck(same, card, sources, true).verdict).toBe("no_source");
  });

  it("lets agreement stand only with a real quote", () => {
    expect(settleCheck(raw({}), card, sources, false)).toMatchObject({ verdict: "agrees", sure: true });
    expect(settleCheck(raw({ quotes: [] }), card, sources, false).sure).toBe(false);
    expect(settleCheck(raw({ quotes: [] }), card, sources, true).verdict).toBe("no_source");
    expect(settleCheck(raw({ confidence: 0.4 }), card, sources, false).sure).toBe(false);
  });

  it("suggests suspending an out-of-scope card", () => {
    const s = settleCheck(raw({ verdict: "out_of_scope", quotes: [] }), card, sources, false);
    expect(s.suggestion).toEqual({ action: "suspend" });
    expect(decisionFor(s)).toBe("pending");
  });

  it("marks a card the model skipped", () => {
    expect(settleCheck(undefined, card, sources, false).sure).toBe(false);
    expect(settleCheck(undefined, card, sources, true)).toMatchObject({ verdict: "no_source", sure: true });
  });
});

describe("tidySuggestions", () => {
  it("keeps cards built from real quotes and skips repeats", () => {
    const out = tidySuggestions(
      {
        cards: [
          { front: "What lab is checked before heparin?", back: "aPTT", quotes: [{ source: 1, quote: "Check aPTT before each heparin dose" }] },
          { front: "Antidote for heparin?", back: "Protamine", quotes: [{ source: 0, quote: "Protamine sulfate is the antidote for heparin" }] },
          { front: "Made up", back: "Nope", quotes: [{ source: 0, quote: "this sentence is not in the book" }] },
          { front: "No quote", back: "None", quotes: [] },
        ],
      },
      sources,
      ["Antidote for heparin?"],
    );
    expect(out.map((c) => c.front)).toEqual(["What lab is checked before heparin?"]);
    expect(out[0].refs[0].label).toBe("Pharm notes: Week 3");
  });
});

describe("deck helpers", () => {
  it("names a deck from the deck, then the file", () => {
    expect(deckNameFrom({ name: "Pharm", cards: [], skipped: 0, truncated: false }, "x.apkg")).toBe("Pharm");
    expect(deckNameFrom({ name: null, cards: [], skipped: 0, truncated: false }, "Fund_cards.apkg")).toBe("Fund cards");
    expect(deckNameFrom({ name: null, cards: [], skipped: 0, truncated: false }, null)).toBe("My Anki deck");
  });

  it("spots a zip file", () => {
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b, 3, 4, 0]))).toBe(true);
    expect(looksLikeZip(new TextEncoder().encode("front\tback"))).toBe(false);
  });
});
