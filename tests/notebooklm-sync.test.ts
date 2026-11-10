import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { contentHash, normalizeExternalKey } from "@/lib/server/ingest/notes";
import { hashBytes, hashFile, isSettled, listNoteFiles, mediaTypeFor, parseArgs, parseEnvFile, planSync } from "../scripts/notebooklm-sync-lib.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "nlm-sync-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("NotebookLM folder sync helpers", () => {
  it("finds note files recursively with forward-slash keys and skips hidden and unsupported files", () => {
    mkdirSync(path.join(dir, "Pharm", "Cardiac"), { recursive: true });
    mkdirSync(path.join(dir, ".obsidian"));
    writeFileSync(path.join(dir, "Pharm", "Cardiac", "digoxin.md"), "# Digoxin\nHold if pulse < 60.");
    writeFileSync(path.join(dir, "Fundamentals.PDF"), "%PDF-1.4");
    writeFileSync(path.join(dir, "notes.txt"), "Hand hygiene.");
    writeFileSync(path.join(dir, "empty.md"), "");
    writeFileSync(path.join(dir, "photo.jpg"), "x");
    writeFileSync(path.join(dir, ".obsidian", "config.md"), "x");
    const { files, tooBig } = listNoteFiles(dir);
    expect(files.map((f: { key: string }) => f.key)).toEqual(["Fundamentals.PDF", "notes.txt", "Pharm/Cardiac/digoxin.md"]);
    expect(files[0].mediaType).toBe("application/pdf");
    expect(tooBig).toEqual([]);
    expect(mediaTypeFor("a.markdown")).toBe("text/markdown");
    expect(mediaTypeFor("a.docx")).toBeNull();
  });

  it("hashes files the same way the server does", () => {
    const file = path.join(dir, "notes.txt");
    expect(hashFile(file)).toBe(contentHash(new TextEncoder().encode("Hand hygiene.")));
    expect(hashBytes("abc")).toBe(contentHash("abc"));
  });

  it("plans uploads, skips unchanged files and only prunes files the sync created", () => {
    const local = [
      { key: "a.md", hash: "h1" },
      { key: "b.md", hash: "h2-new" },
      { key: "c.md", hash: "h3" },
    ];
    const remote = [
      { id: "1", externalKey: "a.md", contentHash: "h1" },
      { id: "2", externalKey: "b.md", contentHash: "h2" },
      { id: "3", externalKey: "gone.md", contentHash: "h9" },
      { id: "4", externalKey: null, contentHash: null },
    ];
    const plan = planSync(local, remote, { prune: true });
    expect(plan.unchanged.map((f: { key: string }) => f.key)).toEqual(["a.md"]);
    expect(plan.upload.map((f: { key: string; replaces: string | null }) => [f.key, f.replaces])).toEqual([
      ["b.md", "2"],
      ["c.md", null],
    ]);
    expect(plan.remove.map((s: { id: string }) => s.id)).toEqual(["3"]);
    expect(planSync(local, remote).remove).toEqual([]);
  });

  it("waits for files that are still being written", () => {
    const file = path.join(dir, "notes.txt");
    const past = new Date(Date.now() - 60_000);
    utimesSync(file, past, past);
    const [entry] = listNoteFiles(dir).files.filter((f: { key: string }) => f.key === "notes.txt");
    expect(isSettled(entry)).toBe(true);
    expect(isSettled({ mtimeMs: Date.now() })).toBe(false);
  });

  it("parses options and .env files", () => {
    expect(parseArgs(["--folder", "~/N", "--app", "https://x", "--watch", "--prune"])).toMatchObject({ folder: "~/N", app: "https://x", watch: 20, prune: true });
    expect(parseArgs(["--watch", "60", "--dry-run"])).toMatchObject({ watch: 60, dryRun: true });
    expect(() => parseArgs(["--watch", "2"])).toThrow(/at least 5/);
    expect(() => parseArgs(["--folder"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown option/);
    expect(parseEnvFile('A=1\nexport B="two words"\n# comment\nC=3 # trailing\nbad line')).toEqual({ A: "1", B: "two words", C: "3" });
  });

  it("normalizes synced file paths on the server", () => {
    expect(normalizeExternalKey("\\\\Pharm\\Cardiac\\digoxin.md")).toBe("Pharm/Cardiac/digoxin.md");
    expect(normalizeExternalKey("  ")).toBeNull();
    expect(() => normalizeExternalKey("x".repeat(501))).toThrow(/too long/);
  });
});
