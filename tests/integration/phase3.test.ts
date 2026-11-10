import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LessonView, PracticeView } from "@/lib/api-types";
import type { Lesson, Syllabus } from "@/lib/server/ai-schemas";
import { startStack, type Stack } from "./stack";

// End-to-end run of the Phase 3 routes (path, lessons, practice, completion, readiness, note sync)
// against real Postgres + PostgREST, with Claude and Voyage faked. Also runs the NotebookLM sync
// script as a real child process against the routes. Skipped without POSTGREST_BIN.
const POSTGREST_BIN = process.env.POSTGREST_BIN;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const run = promisify(execFile);

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const KEYWORDS = ["digoxin", "hand hygiene", "isolation", "heart failure", "insulin", "vital signs"];

function fakeVector(text: string): number[] {
  const v = new Array<number>(1024).fill(0);
  const lower = text.toLowerCase();
  KEYWORDS.forEach((k, i) => {
    if (lower.includes(k)) v[i] = 1;
  });
  v[1023] = 0.05;
  return v;
}

const aiCalls: string[] = [];

const syllabus: Syllabus = {
  course_id: "fundamentals",
  units: [
    {
      title: "Unit 1: Safety",
      modules: [
        {
          chapter_number: "1",
          title: "Infection Control",
          stones: [
            { title: "Hand hygiene", summary: "When to clean your hands.", key_topics: [], tags: [{ client_need_id: "safety_infection", hesi_domain_id: "fundamentals", relevance: 1 }] },
            { title: "Isolation precautions", summary: "Contact, droplet, airborne.", key_topics: [], tags: [{ client_need_id: "safety_infection", hesi_domain_id: "fundamentals", relevance: 0.9 }] },
          ],
        },
      ],
    },
    {
      title: "Unit 2: Medications",
      modules: [
        {
          chapter_number: "2",
          title: "Cardiac Medications",
          stones: [{ title: "Digoxin safety", summary: "Check the apical pulse before digoxin.", key_topics: [], tags: [{ client_need_id: "pharm", hesi_domain_id: "pharmacology", relevance: 1 }] }],
        },
      ],
    },
  ],
};

const options = ["A", "B", "C", "D", "E"].map((id) => ({ id, text: `Option ${id}` }));

function fakeLesson(prompt: string): Lesson {
  const digoxin = prompt.includes("Digoxin safety");
  const quote = /hold if apical pulse under (60|50)/i.exec(prompt)?.[0];
  return {
    eli10: { title: digoxin ? "A slow drum" : "Soap is a bouncer", analogy: "A short everyday comparison." },
    lpn_core: [
      { title: "What's happening", bullets: ["One", "Two", "Three", "Four"] },
      { title: "Data to collect", bullets: ["Collect this"] },
      { title: "LPN actions", bullets: ["Do this", "Report that to the RN"] },
    ],
    exam_alert: { focus: "priority_rule", title: "Safety first", bullets: ["Pick the answer that prevents harm."] },
    notebook_title: quote ? "Your digoxin pearl" : "",
    notebook_pearls: quote ? [{ note_index: 0, quote }] : [],
    quiz: [
      { stem: "First question?", options: options.slice(0, 4), correct_option_ids: ["B"], rationale: "B is safest.", ngn_step_id: "take_action" },
      { stem: "Select all that apply.", options, correct_option_ids: ["A", "C"], rationale: "A and C.", ngn_step_id: "recognize_cues" },
    ],
    checkpoint: {
      scenario: "A client...",
      condition: { prompt: "Most likely?", options: options.slice(0, 4), correct_option_id: "A" },
      actions: { prompt: "Two actions", options, correct_option_ids: ["B", "D"] },
      parameters: { prompt: "Two to monitor", options, correct_option_ids: ["C", "E"] },
      rationale: "Because.",
    },
  };
}

vi.mock("@/lib/server/embeddings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/embeddings")>();
  return {
    ...real,
    embed: async (texts: readonly string[]) => texts.map(fakeVector),
    embedOne: async (text: string) => fakeVector(text),
  };
});

vi.mock("@/lib/server/anthropic", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/anthropic")>();
  return {
    ...real,
    researchWithWebSearch: async () => "NOT_FOUND",
    generateStructured: async (req: { what: string; content: unknown }) => {
      aiCalls.push(req.what);
      switch (req.what) {
        case "design-syllabus":
          return syllabus;
        case "note-pearls":
          return { title: "Cardiac notes", pearl_chunk_indexes: [0] };
        case "lesson-generate":
          return fakeLesson(String(req.content));
        default:
          throw new Error(`Unexpected AI call ${req.what}`);
      }
    },
  };
});

const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://www.googleapis.com/books")) {
    return Response.json({
      items: [{ volumeInfo: { title: "Foundations of Nursing", authors: ["Kim Cooper"], industryIdentifiers: [{ type: "ISBN_13", identifier: "9780323812054" }] } }],
    });
  }
  if (url.startsWith("https://openlibrary.org/isbn/9780323812054")) {
    return Response.json({
      title: "Foundations of nursing",
      table_of_contents: [
        { level: 0, label: "Unit 1", title: "Safety" },
        { level: 1, label: "1", title: "Infection Control" },
        { level: 0, label: "Unit 2", title: "Medications" },
        { level: 1, label: "2", title: "Cardiac Medications" },
        { level: 1, label: "3", title: "Pain" },
      ],
    });
  }
  if (url.startsWith("https://openlibrary.org/")) return Response.json({ docs: [] });
  return realFetch(input, init);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

type Routes = {
  magic: typeof import("@/app/api/magic-ingest/route");
  books: typeof import("@/app/api/books/build-syllabus/route");
  path: typeof import("@/app/api/path/route");
  lesson: typeof import("@/app/api/lessons/generate/route");
  attempt: typeof import("@/app/api/practice/attempt/route");
  complete: typeof import("@/app/api/stones/[stoneId]/complete/route");
  readiness: typeof import("@/app/api/readiness/route");
  sources: typeof import("@/app/api/notes/sources/route");
  source: typeof import("@/app/api/notes/sources/[sourceId]/route");
};

describe.skipIf(!POSTGREST_BIN)("Phase 3 screens' API (integration)", () => {
  let stack: Stack;
  let user: { id: string; token: string };
  let routes: Routes;
  let folder: string;

  const auth = (token = user.token) => ({ authorization: `Bearer ${token}` });
  const postJson = (handler: (r: Request) => Promise<Response>, url: string, body: unknown) =>
    handler(new Request(`http://app${url}`, { method: "POST", body: JSON.stringify(body), headers: { ...auth(), "content-type": "application/json" } }));
  const get = (handler: (r: Request) => Promise<Response>, url: string) => handler(new Request(`http://app${url}`, { headers: auth() }));
  const stoneId = (title: string) => stack.sql(`select id from stepping_stones where title = '${title}' and user_id = '${user.id}'`);
  const lessonFor = async (title: string, refresh = false) => {
    const response = await postJson(routes.lesson.POST, "/api/lessons/generate", { stoneId: stoneId(title), refresh });
    return { status: response.status, body: (await response.json()) as LessonView & { error?: { code: string } } };
  };
  const syncNote = (name: string, content: string, key = name) => {
    const form = new FormData();
    form.append("as", "notes");
    form.append("externalKey", key);
    form.append("files", new File([content], name, { type: "text/markdown" }));
    return routes.magic.POST(new Request("http://app/api/magic-ingest", { method: "POST", body: form, headers: auth() }));
  };

  beforeAll(async () => {
    stack = await startStack(POSTGREST_BIN!);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", stack.url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", stack.anonKey);
    vi.stubEnv("ANTHROPIC_API_KEY", "unused");
    vi.stubEnv("VOYAGE_API_KEY", "unused");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-sonnet-5-5");
    user = stack.newUser();
    routes = {
      magic: await import("@/app/api/magic-ingest/route"),
      books: await import("@/app/api/books/build-syllabus/route"),
      path: await import("@/app/api/path/route"),
      lesson: await import("@/app/api/lessons/generate/route"),
      attempt: await import("@/app/api/practice/attempt/route"),
      complete: await import("@/app/api/stones/[stoneId]/complete/route"),
      readiness: await import("@/app/api/readiness/route"),
      sources: await import("@/app/api/notes/sources/route"),
      source: await import("@/app/api/notes/sources/[sourceId]/route"),
    };
    const built = await postJson(routes.books.POST, "/api/books/build-syllabus", { isbn: "9780323812054" });
    expect(built.status).toBe(201);
    folder = mkdtempSync(path.join(tmpdir(), "nlm-it-"));
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    rmSync(folder, { recursive: true, force: true });
    await stack?.stop();
  });

  it("serves the path in study order with the first stone up next", async () => {
    const response = await get(routes.path.GET, "/api/path");
    const path = await response.json();
    expect(response.status).toBe(200);
    expect(path.courses.map((c: { id: string }) => c.id)).toEqual(["fundamentals"]);
    const stones = path.courses[0].books[0].units.flatMap((u: { modules: { stones: unknown[] }[] }) => u.modules.flatMap((m) => m.stones));
    expect(stones.map((s: { title: string; status: string }) => `${s.title}:${s.status}`)).toEqual([
      "Hand hygiene:ready",
      "Isolation precautions:locked",
      "Digoxin safety:locked",
    ]);
    expect(path.nextStoneId).toBe(stoneId("Hand hygiene"));
    expect(path.counts).toEqual({ stones: 3, ready: 1, mastered: 0, needsReview: 0 });
  });

  it("won't open a locked stone", async () => {
    const { status, body } = await lessonFor("Isolation precautions");
    expect(status).toBe(409);
    expect(body.error?.code).toBe("locked");
  });

  let lesson: LessonView;

  it("builds a 5-card deck once and then serves it from the cache", async () => {
    const before = aiCalls.filter((c) => c === "lesson-generate").length;
    const first = await lessonFor("Hand hygiene");
    expect(first.status).toBe(200);
    lesson = first.body;
    expect(lesson.cached).toBe(false);
    expect(lesson.cards.map((c) => c.kind)).toEqual(["eli10", "lpn_core", "lpn_core", "lpn_core", "exam_alert", "notebooklm", "quick_play"]);
    expect(lesson.cards[1].bullets).toHaveLength(3);
    expect(lesson.cards[5].title).toBe("Your notes go here");
    expect(lesson.practice.map((p) => p.type)).toEqual(["mcq", "sata", "bowtie"]);
    expect(JSON.stringify(lesson.practice)).not.toMatch(/correct|rationale/);

    const second = await lessonFor("Hand hygiene");
    expect(second.body.cached).toBe(true);
    expect(second.body.practice.map((p) => p.id)).toEqual(lesson.practice.map((p) => p.id));
    expect(aiCalls.filter((c) => c === "lesson-generate").length).toBe(before + 1);
    expect(stack.sql("select count(*) from practice_items where item_type = 'lesson_mcq'")).toBe("2");

    const refreshed = await lessonFor("Hand hygiene", true);
    expect(refreshed.body.cached).toBe(false);
    lesson = refreshed.body;
    expect(stack.sql("select count(*) from lessons")).toBe("1");
  });

  it("asks for Quick Play before a stone can be finished", async () => {
    const response = await routes.complete.POST(new Request("http://app/x", { method: "POST", headers: auth() }), {
      params: Promise.resolve({ stoneId: stoneId("Hand hygiene") }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("not_played");
  });

  it("grades answers on the server and saves each attempt", async () => {
    const [mcq, sata, bowtie] = lesson.practice as [PracticeView, PracticeView, PracticeView];
    const wrong = await (await postJson(routes.attempt.POST, "/api/practice/attempt", { itemId: mcq.id, selected: ["A"] })).json();
    expect(wrong).toMatchObject({ correct: false, score: 0, correctOptionIds: ["B"], rationale: "B is safest." });

    const right = await (await postJson(routes.attempt.POST, "/api/practice/attempt", { itemId: mcq.id, selected: ["B"] })).json();
    expect(right.correct).toBe(true);

    const partial = await (await postJson(routes.attempt.POST, "/api/practice/attempt", { itemId: sata.id, selected: ["A", "C", "D"] })).json();
    expect(partial).toMatchObject({ correct: false, score: 0.5 });
    await postJson(routes.attempt.POST, "/api/practice/attempt", { itemId: sata.id, selected: ["A", "C"] });

    const bow = await postJson(routes.attempt.POST, "/api/practice/attempt", {
      itemId: bowtie.id,
      bowtie: { condition: "A", actions: ["B", "D"], parameters: ["C", "E"] },
    });
    expect(bow.status).toBe(201);
    expect((await bow.json()).correct).toBe(true);

    const incomplete = await postJson(routes.attempt.POST, "/api/practice/attempt", { itemId: bowtie.id, bowtie: { condition: "A", actions: ["B"], parameters: [] } });
    expect(incomplete.status).toBe(400);

    expect(stack.sql("select count(*) from practice_attempts")).toBe("5");
    expect(stack.sql("select string_agg(array_to_string(selected_option_ids, ','), ' | ' order by answered_at) from practice_attempts")).toBe(
      "A | B | A,C,D | A,C | condition:A,actions:B,actions:D,parameters:C,parameters:E",
    );
  });

  it("masters the stone at 80% and opens the next one", async () => {
    const response = await routes.complete.POST(new Request("http://app/x", { method: "POST", headers: auth() }), {
      params: Promise.resolve({ stoneId: stoneId("Hand hygiene") }),
    });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toMatchObject({ status: "mastered", mastered: true, score: 1, answered: 3, unlockedStone: { title: "Isolation precautions" } });
    expect(stack.sql("select string_agg(title || ':' || status, ',' order by title) from stepping_stones")).toBe(
      "Digoxin safety:locked,Hand hygiene:mastered,Isolation precautions:ready",
    );
  });

  it("reports readiness from the saved attempts", async () => {
    const response = await get(routes.readiness.GET, "/api/readiness");
    const view = await response.json();
    expect(response.status).toBe(200);
    expect(view.totalAttempts).toBe(5);
    expect(view.hesi).toBeNull();
    expect(view.questionsToUnlockHesi).toBe(15);
    const safety = view.categories.find((c: { id: string }) => c.id === "safety_infection");
    expect(safety).toMatchObject({ attempts: 5, correct: 3 });
    expect(safety.reviewStones.map((s: { title: string }) => s.title)).toEqual(["Isolation precautions", "Hand hygiene"]);
    expect(view.categories).toHaveLength(8);
    expect(view.nclexReadiness).toBeGreaterThan(0);
    expect(view.path).toEqual({ stones: 3, mastered: 1 });
    // Every answer was saved this week, so the trend's last week holds them and the earlier weeks are empty.
    expect(view.trend).toHaveLength(8);
    expect(view.trend.at(-1).attempts).toBeGreaterThanOrEqual(5);
    expect(view.trend.slice(0, -1).every((w: { attempts: number; accuracy: number | null }) => w.attempts === 0 && w.accuracy === null)).toBe(true);
  });

  it("puts the student's own note pearls on card 4", async () => {
    const saved = await syncNote("digoxin.md", "# Digoxin\n\nHold if apical pulse under 60. Remember this on the exam!", "Pharm/digoxin.md");
    const body = await saved.json();
    expect(saved.status).toBe(201);
    expect(body.notes).toMatchObject({ unchanged: false, replaced: false, stonesLinked: 1 });

    stack.sql(`update stepping_stones set status = 'ready' where id = '${stoneId("Digoxin safety")}'`);
    const { body: deck } = await lessonFor("Digoxin safety");
    const notesCard = deck.cards.find((c) => c.kind === "notebooklm");
    expect(notesCard).toMatchObject({ title: "Your digoxin pearl", bullets: ["Hold if apical pulse under 60"] });
  });

  it("skips a synced file that didn't change", async () => {
    const calls = aiCalls.length;
    const response = await syncNote("digoxin.md", "# Digoxin\n\nHold if apical pulse under 60. Remember this on the exam!", "Pharm/digoxin.md");
    const body = await response.json();
    expect(body.message).toBe("Those notes are already up to date.");
    expect(aiCalls.length).toBe(calls);
    expect(stack.sql("select count(*) from lessons where stone_id = (select id from stepping_stones where title = 'Digoxin safety')")).toBe("1");
  });

  it("replaces an edited synced file and rebuilds the lessons that used it", async () => {
    const oldSource = stack.sql("select id from note_sources where external_key = 'Pharm/digoxin.md'");
    const response = await syncNote("digoxin.md", "# Digoxin\n\nNew rule from class: hold if apical pulse under 50 for this client.", "Pharm/digoxin.md");
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.notes).toMatchObject({ replaced: true, unchanged: false });
    expect(body.message).toMatch(/^Updated your notes\./);
    expect(stack.sql("select count(*) from note_sources where external_key = 'Pharm/digoxin.md'")).toBe("1");
    expect(stack.sql("select id from note_sources where external_key = 'Pharm/digoxin.md'")).not.toBe(oldSource);
    expect(stack.sql("select count(*) from note_chunks where content ilike '%under 60%'")).toBe("0");
    expect(stack.sql("select count(*) from lessons where stone_id = (select id from stepping_stones where title = 'Digoxin safety')")).toBe("0");

    const { body: deck } = await lessonFor("Digoxin safety");
    expect(deck.cached).toBe(false);
    expect(deck.cards.find((c) => c.kind === "notebooklm")?.bullets).toEqual(["hold if apical pulse under 50"]);
  });

  it("lists and deletes saved notes", async () => {
    const list = await (await get(routes.sources.GET, "/api/notes/sources")).json();
    const synced = list.sources.find((s: { externalKey: string | null }) => s.externalKey === "Pharm/digoxin.md");
    expect(synced).toMatchObject({ chunks: 1 });
    expect(synced.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const del = await routes.source.DELETE(new Request("http://app/x", { method: "DELETE", headers: auth() }), {
      params: Promise.resolve({ sourceId: synced.id }),
    });
    expect(await del.json()).toEqual({ deleted: true, lessonsRefreshed: 1 });
    expect(stack.sql("select count(*) from note_sources")).toBe("0");

    const again = await routes.source.DELETE(new Request("http://app/x", { method: "DELETE", headers: auth() }), {
      params: Promise.resolve({ sourceId: synced.id }),
    });
    expect(again.status).toBe(404);
  });

  it("keeps lessons, attempts and notes private to each student", async () => {
    const other = stack.newUser();
    const response = await routes.lesson.POST(
      new Request("http://app/api/lessons/generate", {
        method: "POST",
        body: JSON.stringify({ stoneId: stoneId("Hand hygiene") }),
        headers: { ...auth(other.token), "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(404);
    const attempt = await routes.attempt.POST(
      new Request("http://app/api/practice/attempt", {
        method: "POST",
        body: JSON.stringify({ itemId: lesson.practice[0].id, selected: ["B"] }),
        headers: { ...auth(other.token), "content-type": "application/json" },
      }),
    );
    expect(attempt.status).toBe(404);
    const readiness = await (await routes.readiness.GET(new Request("http://app/api/readiness", { headers: auth(other.token) }))).json();
    expect(readiness.totalAttempts).toBe(0);
  });

  it("syncs a folder with the real sync script: add, skip unchanged, update, prune", async () => {
    // Serve the note routes over HTTP so the script runs exactly as it would against the app.
    const server: Server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const request = new Request(`http://app${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      const url = new URL(request.url);
      let response: Response;
      const deleteMatch = /^\/api\/notes\/sources\/([\w-]+)$/.exec(url.pathname);
      if (req.method === "POST" && url.pathname === "/api/magic-ingest") response = await routes.magic.POST(request);
      else if (req.method === "GET" && url.pathname === "/api/notes/sources") response = await routes.sources.GET(request);
      else if (req.method === "DELETE" && deleteMatch) response = await routes.source.DELETE(request, { params: Promise.resolve({ sourceId: deleteMatch[1] }) });
      else response = new Response("not found", { status: 404 });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const app = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const write = (name: string, content: string) => {
      const file = path.join(folder, name);
      writeFileSync(file, content);
      const past = new Date(Date.now() - 60_000);
      utimesSync(file, past, past);
    };
    const sync = async (...flags: string[]) => {
      const { stdout } = await run(process.execPath, [path.join(root, "scripts/notebooklm-sync.mjs"), "--folder", folder, "--app", app, ...flags], {
        cwd: folder,
        env: { ...process.env, LPN_ACCESS_TOKEN: user.token },
      });
      return stdout;
    };

    try {
      write("digoxin.md", "# Digoxin\n\nHold if apical pulse under 60.");
      write("hygiene.txt", "Hand hygiene before and after every client.");
      expect(await sync()).toMatch(/Done: 2 sent, 0 unchanged, 0 removed\./);
      expect(stack.sql(`select string_agg(external_key, ',' order by external_key) from note_sources where user_id = '${user.id}'`)).toBe("digoxin.md,hygiene.txt");

      expect(await sync()).toMatch(/Done: 0 sent, 2 unchanged, 0 removed\./);

      write("digoxin.md", "# Digoxin\n\nHold if apical pulse under 60 and report it.");
      const updated = await sync("--dry-run");
      expect(updated).toMatch(/would update digoxin\.md/);
      expect(await sync()).toMatch(/Updating digoxin\.md \.\.\. Updated your notes\./);

      unlinkSync(path.join(folder, "hygiene.txt"));
      expect(await sync()).toMatch(/0 removed/);
      expect(await sync("--prune")).toMatch(/Removing hygiene\.txt \.\.\. done[\s\S]*1 removed/);
      expect(stack.sql(`select string_agg(external_key, ',') from note_sources where user_id = '${user.id}'`)).toBe("digoxin.md");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 60_000);
});
