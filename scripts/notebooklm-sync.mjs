#!/usr/bin/env node
// Keeps a folder of NotebookLM exports in sync with LPN MasterGuide.
//
// Export your NotebookLM notes (study guides, briefing docs, saved notes) as PDF, markdown or text into
// one folder, then run:
//
//   node scripts/notebooklm-sync.mjs --folder ~/NotebookLM --app https://your-app.example.com
//
// Each top-level subfolder is a notebook in the app ("Pharm notebook/", "Fundamentals notebook/");
// files at the top of the folder go into "My notes".
//
// New files are added, edited files replace their old copy (and the lessons that used them rebuild),
// and unchanged files are skipped. Add --prune to also remove notes whose file you deleted, and
// --watch to keep running and re-check the folder every 20 seconds (or --watch 60 for every minute).
//
// Sign-in: the script signs in as you with the email and password you saved in the app
// (Magic + > Sync a NotebookLM folder). It never uses Google cookies or NotebookLM logins.
//   LPN_EMAIL                                                your app account email
//   LPN_PASSWORD                                             optional; asked for when not set (keeps it out of shell history)
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY  read from .env.local if not set
//   LPN_APP_URL                                              instead of --app
//   LPN_ACCESS_TOKEN                                         a ready-made access token, instead of email and password

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { hashFile, isSettled, listNoteFiles, notebookFor, parseArgs, parseEnvFile, planSync } from "./notebooklm-sync-lib.mjs";

const USAGE = `Usage: node scripts/notebooklm-sync.mjs --folder <dir> --app <url> [--prune] [--watch [seconds]] [--dry-run]`;

function loadEnvFile() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnvFile(readFileSync(file, "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function expandHome(dir) {
  return dir.startsWith("~") ? path.join(os.homedir(), dir.slice(1)) : dir;
}

// Asks for the password without echoing it.
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (text.includes(question)) process.stdout.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

// ---------------------------------------------------------------------------
// Signing in to Supabase as the student (email + password), refreshing as needed
// ---------------------------------------------------------------------------

function createAuth() {
  const fixed = process.env.LPN_ACCESS_TOKEN;
  if (fixed) return { token: async () => fixed };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.LPN_EMAIL;
  let password = process.env.LPN_PASSWORD;
  if (!url || !anonKey) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or run from the app folder with .env.local).");
  if (!email) throw new Error("Set LPN_EMAIL to the account you saved in the app.");
  if (!password && !process.stdin.isTTY) throw new Error("Set LPN_PASSWORD, or run the script in a terminal so it can ask for it.");

  let session = null;
  const request = async (grant, body) => {
    const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Sign-in failed: ${data.error_description ?? data.msg ?? response.status}`);
    session = { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
  };

  return {
    token: async () => {
      password ||= await askHidden(`Password for ${email}: `);
      if (!session) await request("password", { email, password });
      else if (session.expiresAt - Date.now() < 60_000) {
        await request("refresh_token", { refresh_token: session.refreshToken }).catch(() => request("password", { email, password }));
      }
      return session.accessToken;
    },
  };
}

// ---------------------------------------------------------------------------
// Talking to the app
// ---------------------------------------------------------------------------

function createApi(appUrl, auth) {
  const base = appUrl.replace(/\/$/, "");
  const call = async (method, route, body) => {
    const response = await fetch(`${base}${route}`, { method, body, headers: { authorization: `Bearer ${await auth.token()}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message ?? `${method} ${route} failed with ${response.status}`);
    return data;
  };
  return {
    sources: async () => (await call("GET", "/api/notes/sources")).sources,
    upload: async (file) => {
      const form = new FormData();
      form.append("as", "notes");
      form.append("externalKey", file.key);
      const notebook = notebookFor(file.key);
      if (notebook) form.append("notebook", notebook);
      form.append("files", new Blob([readFileSync(file.abs)], { type: file.mediaType }), path.basename(file.abs));
      return call("POST", "/api/magic-ingest", form);
    },
    remove: async (id) => call("DELETE", `/api/notes/sources/${id}`),
  };
}

// ---------------------------------------------------------------------------
// One pass over the folder
// ---------------------------------------------------------------------------

async function syncOnce(folder, api, options, warned) {
  const { files, tooBig } = listNoteFiles(folder);
  for (const file of tooBig) {
    if (warned.has(file.key)) continue;
    warned.add(file.key);
    console.warn(`! Skipping ${file.key}: files must be under 25 MB. Split it into smaller exports.`);
  }

  const settled = files.filter((f) => isSettled(f));
  const local = settled.map((f) => ({ ...f, hash: hashFile(f.abs) }));
  const remote = await api.sources();
  // A file that is still being written must not look deleted to --prune.
  const pending = files.filter((f) => !isSettled(f)).map((f) => ({ ...f, hash: null }));
  const plan = planSync([...local, ...pending], remote, options);
  const toUpload = plan.upload.filter((f) => f.hash !== null);

  let failed = 0;
  for (const file of toUpload) {
    if (options.dryRun) {
      console.log(`  would ${file.replaces ? "update" : "add"} ${file.key}`);
      continue;
    }
    process.stdout.write(`  ${file.replaces ? "Updating" : "Adding"} ${file.key} ... `);
    try {
      const result = await api.upload(file);
      console.log(result.message ?? "done");
    } catch (error) {
      failed++;
      console.log(`failed: ${error.message}`);
    }
  }
  for (const source of plan.remove) {
    if (options.dryRun) {
      console.log(`  would remove ${source.externalKey}`);
      continue;
    }
    process.stdout.write(`  Removing ${source.externalKey} ... `);
    try {
      await api.remove(source.id);
      console.log("done");
    } catch (error) {
      failed++;
      console.log(`failed: ${error.message}`);
    }
  }
  return { uploaded: toUpload.length, unchanged: plan.unchanged.length, removed: plan.remove.length, failed };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(2);
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }

  loadEnvFile();
  const folderArg = options.folder ?? process.env.LPN_SYNC_FOLDER;
  const appUrl = options.app ?? process.env.LPN_APP_URL;
  if (!folderArg || !appUrl) {
    console.error(`Both a folder and the app address are needed.\n${USAGE}`);
    process.exit(2);
  }
  const folder = path.resolve(expandHome(folderArg));
  if (!existsSync(folder)) {
    console.error(`Folder not found: ${folder}`);
    process.exit(2);
  }

  const api = createApi(appUrl, createAuth());
  const warned = new Set();
  console.log(`Syncing ${folder} -> ${appUrl}${options.prune ? " (removing deleted files)" : ""}${options.dryRun ? " (dry run)" : ""}`);

  if (options.watch === null) {
    const result = await syncOnce(folder, api, options, warned);
    console.log(`Done: ${result.uploaded} sent, ${result.unchanged} unchanged, ${result.removed} removed${result.failed ? `, ${result.failed} failed` : ""}.`);
    process.exit(result.failed ? 1 : 0);
  }

  console.log(`Watching for changes every ${options.watch} seconds. Press Ctrl+C to stop.`);
  for (;;) {
    try {
      const result = await syncOnce(folder, api, options, warned);
      if (result.uploaded || result.removed) {
        console.log(`[${new Date().toLocaleTimeString()}] ${result.uploaded} sent, ${result.removed} removed${result.failed ? `, ${result.failed} failed` : ""}.`);
      }
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] Sync pass failed: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, options.watch * 1000));
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
