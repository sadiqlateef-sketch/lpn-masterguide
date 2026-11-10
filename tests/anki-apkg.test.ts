import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { crc32, deflateRawSync, zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  buildApkg,
  clozeSides,
  collectionBytes,
  DeckFormatError,
  fieldToText,
  MAX_FIELD_CHARS,
  noteToCard,
  parseApkg,
  parseTextExport,
  splitDelimited,
  stableGuid,
} from "@/lib/server/anki/apkg";
import { listZip, readZipEntry, writeZip } from "@/lib/server/anki/zip";

// A zip with deflated entries, the way Anki itself writes .apkg files.
function deflatedZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const body = new Uint8Array(deflateRawSync(f.data));
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc32(f.data) >>> 0, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    c.set(name, 46);
    parts.push(local, body);
    central.push(c);
    offset += local.length + body.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let p = 0;
  for (const part of [...parts, ...central, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

// A newer-style collection: notetypes, fields and decks tables, zstd-compressed as collection.anki21b.
function anki21bCollection(): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "anki-test-"));
  const path = join(dir, "c.db");
  try {
    const db = new DatabaseSync(path);
    db.exec(`
      create table notetypes (id integer primary key, name text, mtime_secs integer, usn integer, config blob);
      create table fields (ntid integer, ord integer, name text, config blob);
      create table decks (id integer primary key, name text, mtime_secs integer, usn integer, common blob, kind blob);
      create table notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld text, csum integer, flags integer, data text);
      create table cards (id integer primary key, nid integer, did integer, ord integer);
      insert into decks values (1, 'Default', 0, 0, null, null), (77, 'Nursing' || char(31) || 'Pharm', 0, 0, null, null);
      insert into notes values
        (1, 'g1', 5, 0, 0, ' pharm cardiac ', 'Digoxin toxicity sign?' || char(31) || 'Nausea, vision changes (yellow halos)', '', 0, 0, ''),
        (2, 'g2', 6, 0, 0, '', 'Normal K+ is {{c1::3.5 to 5.0::range}} mEq/L' || char(31) || 'Low K+ raises digoxin toxicity risk', '', 0, 0, ''),
        (3, 'g3', 5, 0, 0, '', '<img src="x.png">' || char(31) || '', '', 0, 0, '');
      insert into cards values (10, 1, 77, 0), (11, 2, 77, 0), (12, 3, 1, 0);
    `);
    db.close();
    return new Uint8Array(zstdCompressSync(readFileSync(path)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Anki field text", () => {
  it("turns field HTML into plain text", () => {
    expect(fieldToText("Give <b>with food</b><br>Check&nbsp;apical pulse &gt; 60")).toBe("Give with food\nCheck apical pulse > 60");
    expect(fieldToText("<div>One</div><div>Two</div>")).toBe("One\nTwo");
    expect(fieldToText('<ul><li>A</li><li>B</li></ul>')).toBe("- A\n- B");
    expect(fieldToText('See <img src="heart.png"> [sound:beat.mp3]')).toBe("See [image]");
    expect(fieldToText("<script>alert(1)</script>Safe &#x2265; &#8805; &bogus;")).toBe("Safe ≥ ≥ &bogus;");
  });

  it("splits cloze notes into a front with blanks and a back with answers", () => {
    expect(clozeSides("K+ {{c1::3.5 to 5.0::range}} and Na+ {{c2::135 to 145}}")).toEqual({
      front: "K+ [range] and Na+ [...]",
      back: "K+ 3.5 to 5.0 and Na+ 135 to 145",
    });
  });

  it("makes one card per note and skips empty ones", () => {
    expect(noteToCard(["Front", "Back", "", "Extra"], { noteId: "1", guid: "g", tags: " a  b " })).toEqual({
      noteId: "1",
      guid: "g",
      front: "Front",
      back: "Back\n\nExtra",
      tags: ["a", "b"],
      cloze: false,
    });
    expect(noteToCard(["Only a front"], { noteId: null, guid: null, tags: "" })).toBeNull();
    expect(noteToCard(["x".repeat(MAX_FIELD_CHARS + 50), "y"], { noteId: null, guid: null, tags: "" })!.front.length).toBe(MAX_FIELD_CHARS);
  });
});

describe(".apkg files", () => {
  it("reads a newer zstd collection inside a deflated zip, preferring it over the stub", async () => {
    const apkg = deflatedZip([
      { name: "collection.anki2", data: new TextEncoder().encode("stub that says to update Anki") },
      { name: "collection.anki21b", data: anki21bCollection() },
      { name: "media", data: new Uint8Array() },
    ]);
    const deck = await parseApkg(apkg);
    expect(deck.name).toBe("Nursing::Pharm");
    expect(deck.skipped).toBe(1);
    expect(deck.truncated).toBe(false);
    expect(deck.cards).toEqual([
      { noteId: "1", guid: "g1", front: "Digoxin toxicity sign?", back: "Nausea, vision changes (yellow halos)", tags: ["pharm", "cardiac"], cloze: false },
      {
        noteId: "2",
        guid: "g2",
        front: "Normal K+ is [range] mEq/L",
        back: "Normal K+ is 3.5 to 5.0 mEq/L\n\nLow K+ raises digoxin toxicity risk",
        tags: [],
        cloze: true,
      },
    ]);
  });

  it("refuses files that aren't Anki decks", async () => {
    await expect(parseApkg(new TextEncoder().encode("hello"))).rejects.toBeInstanceOf(DeckFormatError);
    expect(() => collectionBytes(writeZip([{ name: "readme.txt", data: new Uint8Array([1]) }]))).toThrow(DeckFormatError);
  });

  it("writes an .apkg that reads back the same, with stable ids", async () => {
    const cards = [
      { id: "c1", front: "Furosemide: watch which electrolyte?", back: "Potassium <low>\nCheck labs", tags: ["pharm", "loop diuretic"] },
      { id: "c2", front: "Second", back: "Answer & more", tags: [] },
    ];
    const now = new Date("2026-11-10T12:00:00Z");
    const apkg = await buildApkg({ id: "deck-1", name: "Pharm (checked)" }, cards, now);
    expect(listZip(apkg).map((e) => e.name)).toEqual(["collection.anki2", "media"]);
    const media = readZipEntry(apkg, listZip(apkg)[1], 100);
    expect(new TextDecoder().decode(media)).toBe("{}");

    const back = await parseApkg(apkg);
    expect(back.name).toBe("Pharm (checked)");
    expect(back.cards.map((c) => [c.front, c.back, c.tags])).toEqual([
      ["Furosemide: watch which electrolyte?", "Potassium <low>\nCheck labs", ["pharm", "loop_diuretic"]],
      ["Second", "Answer & more", []],
    ]);
    // Exporting again gives the same notes, so Anki updates them instead of adding copies.
    const again = await parseApkg(await buildApkg({ id: "deck-1", name: "Pharm (checked)" }, cards, now));
    expect(again.cards.map((c) => c.guid)).toEqual(back.cards.map((c) => c.guid));
    expect(back.cards[0].guid).toBe(stableGuid("c1"));
  });
});

describe("plain-text exports", () => {
  it("handles quotes, separators and line breaks inside fields", () => {
    expect(splitDelimited('a\t"b\tc"\n"multi\nline"\t"say ""hi"""', "\t")).toEqual([
      ["a", "b\tc"],
      ["multi\nline", 'say "hi"'],
    ]);
  });

  it("reads Anki's header lines for the separator and the tags column", () => {
    const text = "#separator:tab\n#html:true\n#tags column:3\n#deck:Fundamentals\nHand hygiene first?\tYes, before every contact\tfund infection\n\nEmpty back\t\t\n";
    expect(parseTextExport(text)).toEqual({
      name: "Fundamentals",
      cards: [{ noteId: null, guid: null, front: "Hand hygiene first?", back: "Yes, before every contact", tags: ["fund", "infection"], cloze: false }],
      skipped: 1,
      truncated: false,
    });
  });

  it("guesses the separator with no headers", () => {
    expect(parseTextExport("Q1;A1\nQ2;A2").cards.map((c) => c.back)).toEqual(["A1", "A2"]);
  });
});
