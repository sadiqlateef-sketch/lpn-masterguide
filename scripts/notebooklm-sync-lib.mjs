// Pure helpers for scripts/notebooklm-sync.mjs. No network calls here, so tests can import them.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const NOTE_EXTENSIONS = { ".md": "text/markdown", ".markdown": "text/markdown", ".txt": "text/plain", ".pdf": "application/pdf" };
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function mediaTypeFor(name) {
  return NOTE_EXTENSIONS[path.extname(name).toLowerCase()] ?? null;
}

// Every note file under `folder`, keyed by its path relative to the folder (always with forward slashes).
// Hidden files and folders are skipped. Returns files that are too big separately so the caller can warn.
export function listNoteFiles(folder) {
  const files = [];
  const tooBig = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile() || !mediaTypeFor(entry.name)) continue;
      const stat = statSync(abs);
      const key = path.relative(folder, abs).split(path.sep).join("/");
      const file = { key, abs, size: stat.size, mtimeMs: stat.mtimeMs, mediaType: mediaTypeFor(entry.name) };
      if (stat.size > MAX_FILE_BYTES) tooBig.push(file);
      else if (stat.size > 0) files.push(file);
    }
  };
  walk(folder);
  files.sort((a, b) => a.key.localeCompare(b.key));
  return { files, tooBig };
}

// Same hash the server stores for a synced file (sha256 of the raw bytes).
// The notebook a file belongs to: its top-level subfolder ("Pharm notebook/week 3.md" -> "Pharm notebook").
// Files at the top of the folder go into "My notes".
export function notebookFor(key) {
  const slash = key.indexOf("/");
  if (slash <= 0) return null;
  const name = key.slice(0, slash).replace(/\s+/g, " ").trim();
  return name ? name.slice(0, 80) : null;
}

export function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hashFile(abs) {
  return hashBytes(readFileSync(abs));
}

// Decides what to send. `local` is [{ key, hash, ... }]; `remote` is the app's saved note sources.
// Only sources the sync created (they have an externalKey) are ever removed.
export function planSync(local, remote, { prune = false } = {}) {
  const synced = new Map(remote.filter((s) => s.externalKey).map((s) => [s.externalKey, s]));
  const upload = [];
  const unchanged = [];
  for (const file of local) {
    const existing = synced.get(file.key);
    if (existing && existing.contentHash === file.hash) unchanged.push(file);
    else upload.push({ ...file, replaces: existing?.id ?? null });
  }
  const localKeys = new Set(local.map((f) => f.key));
  const remove = prune ? [...synced.values()].filter((s) => !localKeys.has(s.externalKey)) : [];
  return { upload, unchanged, remove };
}

// Files still being written (changed in the last few seconds) wait for the next pass.
export function isSettled(file, now = Date.now(), settleMs = 3000) {
  return now - file.mtimeMs >= settleMs;
}

export function parseArgs(argv) {
  const options = { folder: null, app: null, watch: null, prune: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      i++;
      return value;
    };
    switch (arg) {
      case "--folder":
        options.folder = next();
        break;
      case "--app":
        options.app = next();
        break;
      case "--watch": {
        const value = argv[i + 1];
        if (value !== undefined && /^\d+$/.test(value)) {
          options.watch = Number(value);
          i++;
        } else {
          options.watch = 20;
        }
        break;
      }
      case "--prune":
        options.prune = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option ${arg}`);
    }
  }
  if (options.watch !== null && options.watch < 5) throw new Error("--watch needs at least 5 seconds");
  return options;
}

// Reads KEY=value lines (as in .env.local) without overriding variables already set.
export function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    values[match[1]] = value;
  }
  return values;
}
