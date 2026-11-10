import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { listZip, readZipEntry, writeZip, ZipError } from "./zip";

// Reads Anki decks (.apkg, or Anki's "Notes in plain text" export) into plain-text cards, and writes
// checked cards back out as an .apkg. Uses Node's built-in SQLite, so no extra packages.

export const MAX_DECK_CARDS = 2000;
export const MAX_FIELD_CHARS = 2000;
const MAX_COLLECTION_BYTES = 300 * 1024 * 1024;

export class DeckFormatError extends Error {}

export type ParsedCard = { noteId: string | null; guid: string | null; front: string; back: string; tags: string[]; cloze: boolean };
export type ParsedDeck = { name: string | null; cards: ParsedCard[]; skipped: number; truncated: boolean };

// ---------------------------------------------------------------------------
// Field text
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

// Anki fields are HTML. Cards here are plain text: line breaks kept, pictures and sounds marked, tags dropped.
export function fieldToText(html: string): string {
  const text = html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\s*\/\s*(div|p|tr|h\d)\s*>/gi, "\n")
    .replace(/<\s*img[^>]*>/gi, " [image] ")
    .replace(/\[sound:[^\]]*\]/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, code: string) => {
      const lower = code.toLowerCase();
      if (ENTITIES[lower] !== undefined) return ENTITIES[lower];
      if (lower.startsWith("#x")) return safeChar(parseInt(lower.slice(2), 16)) ?? whole;
      if (lower.startsWith("#")) return safeChar(parseInt(lower.slice(1), 10)) ?? whole;
      return whole;
    });
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeChar(code: number): string | null {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;
}

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export function isCloze(text: string): boolean {
  return /\{\{c\d+::/.test(text);
}

// The front hides every cloze (showing its hint), the back shows the answers.
export function clozeSides(text: string): { front: string; back: string } {
  return {
    front: text.replace(CLOZE, (_, _n, _answer, hint?: string) => `[${hint?.trim() || "..."}]`),
    back: text.replace(CLOZE, (_, _n, answer: string) => answer),
  };
}

function clip(text: string): string {
  return text.length > MAX_FIELD_CHARS ? `${text.slice(0, MAX_FIELD_CHARS - 1).trimEnd()}…` : text;
}

// A note's fields, in order, as one card.
export function noteToCard(fields: readonly string[], meta: { noteId: string | null; guid: string | null; tags: string }): ParsedCard | null {
  const texts = fields.map(fieldToText);
  const [first = "", ...rest] = texts;
  const extra = rest.filter(Boolean);
  let front: string;
  let back: string;
  const cloze = isCloze(first);
  if (cloze) {
    const sides = clozeSides(first);
    front = sides.front;
    back = [sides.back, ...extra].join("\n\n");
  } else {
    front = first;
    back = extra.join("\n\n");
  }
  front = clip(front.trim());
  back = clip(back.trim());
  if (!front || !back) return null;
  const tags = meta.tags
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((t) => t.slice(0, 60));
  return { noteId: meta.noteId, guid: meta.guid, front, back, tags, cloze };
}

// ---------------------------------------------------------------------------
// .apkg
// ---------------------------------------------------------------------------

type Sqlite = typeof import("node:sqlite");

async function sqlite(): Promise<Sqlite> {
  try {
    return await import("node:sqlite");
  } catch {
    throw new DeckFormatError("This server can't open .apkg files yet. Export the deck from Anki as Notes in Plain Text and add that instead.");
  }
}

function withTempFile<T>(bytes: Uint8Array | null, work: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "anki-"));
  const path = join(dir, "collection.db");
  try {
    if (bytes) writeFileSync(path, bytes);
    return work(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Newer Anki exports keep the real collection in collection.anki21b (zstd); collection.anki2 is then
// only a stub that says to update Anki.
export function collectionBytes(apkg: Uint8Array): Uint8Array {
  let entries;
  try {
    entries = listZip(apkg);
  } catch (e) {
    throw new DeckFormatError(e instanceof ZipError ? "That file isn't an Anki deck (.apkg)." : "That deck couldn't be opened.");
  }
  for (const name of ["collection.anki21b", "collection.anki21", "collection.anki2"]) {
    const entry = entries.find((e) => e.name === name);
    if (!entry) continue;
    try {
      const raw = readZipEntry(apkg, entry, MAX_COLLECTION_BYTES);
      if (name.endsWith("b")) {
        const out = zstdDecompressSync(raw, { maxOutputLength: MAX_COLLECTION_BYTES });
        return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
      }
      return raw;
    } catch {
      throw new DeckFormatError("That deck is too big or damaged to open.");
    }
  }
  throw new DeckFormatError("That file has no Anki collection inside. Export it from Anki as an .apkg deck.");
}

type NoteRow = { id: number | bigint; guid: string; mid: number | bigint; tags: string; flds: string };

export async function parseApkg(apkg: Uint8Array): Promise<ParsedDeck> {
  const db = collectionBytes(apkg);
  const { DatabaseSync } = await sqlite();
  return withTempFile(db, (path) => {
    let conn;
    try {
      conn = new DatabaseSync(path, { readOnly: true });
    } catch {
      throw new DeckFormatError("That deck's collection couldn't be read.");
    }
    try {
      const tables = new Set((conn.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((t) => t.name));
      if (!tables.has("notes")) throw new DeckFormatError("That deck has no notes in it.");

      const total = Number((conn.prepare("select count(*) as n from notes").get() as { n: number | bigint }).n);
      const rows = conn.prepare("select id, guid, mid, tags, flds from notes order by id limit ?").all(MAX_DECK_CARDS) as NoteRow[];
      const cards: ParsedCard[] = [];
      let skipped = 0;
      for (const row of rows) {
        const card = noteToCard(String(row.flds).split("\x1f"), { noteId: String(row.id), guid: String(row.guid), tags: String(row.tags ?? "") });
        if (card) cards.push(card);
        else skipped++;
      }
      return { name: deckName(conn, tables), cards, skipped, truncated: total > rows.length };
    } catch (e) {
      if (e instanceof DeckFormatError) throw e;
      throw new DeckFormatError("That deck's collection couldn't be read.");
    } finally {
      conn.close();
    }
  });
}

type Conn = InstanceType<Sqlite["DatabaseSync"]>;

// The deck most cards belong to.
function deckName(conn: Conn, tables: Set<string>): string | null {
  if (!tables.has("cards")) return null;
  const top = conn.prepare("select did from cards group by did order by count(*) desc limit 1").get() as { did: number | bigint } | undefined;
  if (!top) return null;
  const did = String(top.did);
  if (tables.has("decks")) {
    const row = conn.prepare("select name from decks where id = ?").get(top.did) as { name: string } | undefined;
    return row ? cleanDeckName(row.name) : null;
  }
  if (tables.has("col")) {
    const col = conn.prepare("select decks from col limit 1").get() as { decks: string } | undefined;
    try {
      const decks = JSON.parse(col?.decks ?? "{}") as Record<string, { name?: string }>;
      return decks[did]?.name ? cleanDeckName(decks[did].name!) : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function cleanDeckName(name: string): string | null {
  const clean = name.replace(/\x1f/g, "::").replace(/\s+/g, " ").trim().slice(0, 120);
  return clean && clean !== "Default" ? clean : null;
}

// ---------------------------------------------------------------------------
// Plain-text export
// ---------------------------------------------------------------------------

const SEPARATORS: Record<string, string> = { tab: "\t", comma: ",", semicolon: ";", pipe: "|", space: " ", colon: ":" };

// Splits delimited text, honoring "quoted" fields that hold separators, quotes ("") or line breaks.
export function splitDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let atStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (c === sep) {
      row.push(field);
      field = "";
      atStart = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      atStart = true;
    } else {
      field += c;
      atStart = false;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseTextExport(text: string): ParsedDeck {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headers: Record<string, string> = {};
  let bodyStart = 0;
  while (bodyStart < lines.length && lines[bodyStart].startsWith("#")) {
    const m = /^#([a-z ]+):(.*)$/i.exec(lines[bodyStart]);
    if (m) headers[m[1].trim().toLowerCase()] = m[2].trim();
    bodyStart++;
  }
  const body = lines.slice(bodyStart).join("\n");
  const sepName = headers.separator?.toLowerCase();
  const sep = sepName ? (SEPARATORS[sepName] ?? (sepName.length === 1 ? sepName : "\t")) : body.includes("\t") ? "\t" : body.includes(";") ? ";" : ",";

  const col = (key: string) => {
    const n = Number(headers[key]);
    return Number.isInteger(n) && n >= 1 ? n - 1 : -1;
  };
  const tagsCol = col("tags column");
  const guidCol = col("guid column");
  const metaCols = new Set([tagsCol, guidCol, col("notetype column"), col("deck column")].filter((n) => n >= 0));

  const all = splitDelimited(body, sep).filter((r) => r.some((f) => f.trim()));
  const cards: ParsedCard[] = [];
  let skipped = 0;
  for (const row of all.slice(0, MAX_DECK_CARDS)) {
    const fields = row.filter((_, i) => !metaCols.has(i));
    const card = noteToCard(fields, { noteId: null, guid: guidCol >= 0 ? (row[guidCol] ?? null) : null, tags: tagsCol >= 0 ? (row[tagsCol] ?? "") : "" });
    if (card) cards.push(card);
    else skipped++;
  }
  return { name: headers.deck ? cleanDeckName(headers.deck) : null, cards, skipped, truncated: all.length > MAX_DECK_CARDS };
}

// ---------------------------------------------------------------------------
// Writing an .apkg (Anki's long-standing schema 11, which every Anki version still imports)
// ---------------------------------------------------------------------------

export type ExportCard = { id: string; front: string; back: string; tags: string[] };

const SCHEMA_11 = `
create table col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null,
  dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
create table notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null,
  tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
create table cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null,
  usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null,
  reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null,
  data text not null);
create table revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null,
  lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
create table graves (usn integer not null, oid integer not null, type integer not null);
create index ix_notes_usn on notes (usn);
create index ix_cards_usn on cards (usn);
create index ix_revlog_usn on revlog (usn);
create index ix_cards_nid on cards (nid);
create index ix_cards_sched on cards (did, queue, due);
create index ix_revlog_cid on revlog (cid);
create index ix_notes_csum on notes (csum);
`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

// A stable 52-bit number from a string, so ids stay the same between exports.
function stableId(seed: string): number {
  return parseInt(createHash("sha1").update(seed).digest("hex").slice(0, 13), 16) % 2 ** 52 || 1;
}

// Anki's own guid style: base91 text from a 64-bit number. Here it comes from the card's id.
const BASE91 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";
export function stableGuid(seed: string): string {
  let n = BigInt(`0x${createHash("sha1").update(`guid:${seed}`).digest("hex").slice(0, 16)}`);
  let out = "";
  while (n > 0n) {
    out = BASE91[Number(n % 91n)] + out;
    n /= 91n;
  }
  return out || "a";
}

function fieldChecksum(text: string): number {
  return parseInt(createHash("sha1").update(text).digest("hex").slice(0, 8), 16);
}

export async function buildApkg(deck: { id: string; name: string }, cards: readonly ExportCard[], now = new Date()): Promise<Uint8Array> {
  const { DatabaseSync } = await sqlite();
  const sec = Math.floor(now.getTime() / 1000);
  const modelId = stableId(`model:lpn-masterguide-basic`);
  const deckId = stableId(`deck:${deck.id}`);

  const models = {
    [modelId]: {
      id: modelId,
      name: "LPN MasterGuide Basic",
      type: 0,
      mod: sec,
      usn: -1,
      sortf: 0,
      did: deckId,
      tmpls: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}", did: null, bqfmt: "", bafmt: "" }],
      flds: ["Front", "Back"].map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: "Arial", size: 20, media: [] })),
      css: ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }",
      latexPre: "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
      latexPost: "\\end{document}",
      tags: [],
      vers: [],
      req: [[0, "all", [0]]],
    },
  };
  const deckJson = (id: number, name: string) => ({
    id,
    name,
    mod: sec,
    usn: -1,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: false,
    desc: "",
    dyn: 0,
    conf: 1,
    extendNew: 10,
    extendRev: 50,
  });
  const decks = { "1": deckJson(1, "Default"), [deckId]: deckJson(deckId, deck.name) };
  const dconf = {
    "1": {
      id: 1,
      name: "Default",
      replayq: true,
      lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 0 },
      rev: { perDay: 200, ease4: 1.3, fuzz: 0.05, minSpace: 1, ivlFct: 1, maxIvl: 36500, bury: false },
      timer: 0,
      maxTaken: 60,
      usn: 0,
      new: { delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500, separate: true, order: 1, perDay: 20, bury: false },
      mod: 0,
      autoplay: true,
    },
  };
  const conf = {
    nextPos: cards.length + 1,
    estTimes: true,
    activeDecks: [1],
    sortType: "noteFld",
    timeLim: 0,
    sortBackwards: false,
    addToCur: true,
    curDeck: 1,
    newSpread: 0,
    dueCounts: true,
    curModel: String(modelId),
    collapseTime: 1200,
  };

  const collection = withTempFile(null, (path) => {
    const db = new DatabaseSync(path);
    try {
      db.exec(SCHEMA_11);
      db.prepare("insert into col values (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')").run(
        sec,
        sec * 1000,
        sec * 1000,
        JSON.stringify(conf),
        JSON.stringify(models),
        JSON.stringify(decks),
        JSON.stringify(dconf),
      );
      const note = db.prepare("insert into notes values (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')");
      const card = db.prepare("insert into cards values (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')");
      const used = new Set<number>();
      cards.forEach((c, i) => {
        let noteId = stableId(`note:${c.id}`);
        while (used.has(noteId)) noteId++;
        used.add(noteId);
        let cardId = stableId(`card:${c.id}`);
        while (used.has(cardId)) cardId++;
        used.add(cardId);
        const front = escapeHtml(c.front);
        const tags = c.tags.map((t) => t.replace(/\s+/g, "_")).filter(Boolean);
        note.run(noteId, stableGuid(c.id), modelId, sec, tags.length ? ` ${tags.join(" ")} ` : "", `${front}\x1f${escapeHtml(c.back)}`, c.front, fieldChecksum(c.front));
        card.run(cardId, noteId, deckId, sec, i + 1);
      });
    } finally {
      db.close();
    }
    return new Uint8Array(readFileSync(path));
  });

  return writeZip([
    { name: "collection.anki2", data: collection },
    { name: "media", data: new TextEncoder().encode("{}") },
  ]);
}
