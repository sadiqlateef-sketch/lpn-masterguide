import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Syllabus, TwinPractice, UWorldQuestion } from "@/lib/server/ai-schemas";
import { startStack, type Stack } from "./stack";

// End-to-end run of the three Phase 2 routes against real Postgres + PostgREST.
// Claude and Voyage are replaced with deterministic fakes; everything else is real.
// Needs PGHOST/PGPORT/PGUSER for a Postgres with pgvector, and POSTGREST_BIN. Skipped otherwise.
const POSTGREST_BIN = process.env.POSTGREST_BIN;

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
            { title: "Hand hygiene", summary: "When to clean your hands.", key_topics: ["hand hygiene"], tags: [{ client_need_id: "safety_infection", hesi_domain_id: "fundamentals", relevance: 1 }] },
            { title: "Isolation precautions", summary: "Contact, droplet, airborne.", key_topics: ["isolation"], tags: [{ client_need_id: "safety_infection", hesi_domain_id: "fundamentals", relevance: 0.9 }] },
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
          stones: [
            { title: "Digoxin safety", summary: "Check the apical pulse before digoxin.", key_topics: ["digoxin"], tags: [{ client_need_id: "pharm", hesi_domain_id: "pharmacology", relevance: 1 }] },
          ],
        },
        {
          chapter_number: "3",
          title: "Measuring the Body",
          stones: [{ title: "Taking vital signs", summary: "Pulse, BP, respirations.", key_topics: ["vital signs"], tags: [] }],
        },
      ],
    },
  ],
};

const digoxinQuestion: UWorldQuestion = {
  is_question: true,
  question_type: "single_answer",
  vignette: "A client with heart failure takes digoxin. Apical pulse is 54/min.",
  choices: [
    { id: "A", text: "Give the dose" },
    { id: "B", text: "Hold the dose and report" },
    { id: "C", text: "Recheck tomorrow" },
    { id: "D", text: "Give half the dose" },
  ],
  correct_choice_ids: ["B"],
  user_choice_ids: ["A"],
  user_answer_visible: true,
  user_missed: true,
  core_takeaway: "Hold digoxin and report an apical pulse under 60.",
  trap_analysis: [{ choice_id: "A", why_wrong: "Giving it can worsen bradycardia." }],
  topic: "digoxin toxicity",
  client_need_id: "pharm",
  hesi_domain_id: "pharmacology",
  ngn_step_id: "take_action",
};

const handHygieneQuestion: UWorldQuestion = {
  ...digoxinQuestion,
  vignette: "Which situation requires soap and water for hand hygiene?",
  core_takeaway: "Use soap and water for C. diff; alcohol rub does not kill spores.",
  topic: "hand hygiene",
  client_need_id: "safety_infection",
  hesi_domain_id: "fundamentals",
  ngn_step_id: "generate_solutions",
};

const options = ["A", "B", "C", "D", "E"].map((id) => ({ id, text: `Option ${id}` }));
const twin: TwinPractice = {
  twin: { stem: "A new client...", options: options.slice(0, 4), correct_option_ids: ["C"], rationale: "r", lpn_scope_note: "Within LPN scope.", option_rationales: [] },
  bowtie: {
    scenario: "s",
    condition: { prompt: "p", options: options.slice(0, 4), correct_option_id: "A" },
    actions: { prompt: "p", options, correct_option_ids: ["B", "D"] },
    parameters: { prompt: "p", options, correct_option_ids: ["A", "E"] },
    rationale: "r",
  },
};

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
    researchWithWebSearch: async () => {
      aiCalls.push("toc-web-search");
      return "NOT_FOUND";
    },
    generateStructured: async (req: { what: string; content: unknown }) => {
      aiCalls.push(req.what);
      const content = JSON.stringify(req.content);
      switch (req.what) {
        case "classify-text":
          return { kind: "unknown", confidence: 0.9, book_title_guess: "", isbn_guess: "", reason: "chit-chat" };
        case "classify-images":
          return { kind: "uworld_screenshot", confidence: 0.95, book_title_guess: "", isbn_guess: "", reason: "question screen" };
        case "design-syllabus":
          return syllabus;
        case "uworld-extract":
          return content.includes("digoxin") ? digoxinQuestion : handHygieneQuestion;
        case "twin-questions":
          return twin;
        case "note-pearls":
          return { title: "Pharm and safety notes", pearl_chunk_indexes: [0] };
        case "retag-stones":
          return { stones: [{ stone_index: 0, tags: [{ client_need_id: "risk_reduction", hesi_domain_id: "fundamentals", relevance: 0.8 }] }] };
        default:
          throw new Error(`Unexpected AI call ${req.what}`);
      }
    },
  };
});

// Catalog lookups get canned answers; everything else (the local Supabase stack) goes through.
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://www.googleapis.com/books")) {
    if (url.includes("9780323812054")) {
      return Response.json({
        items: [{ volumeInfo: { title: "Foundations of Nursing", subtitle: "9th Edition", authors: ["Kim Cooper"], industryIdentifiers: [{ type: "ISBN_13", identifier: "9780323812054" }] } }],
      });
    }
    return Response.json({ items: [] });
  }
  if (url.startsWith("https://openlibrary.org/isbn/9780323812054")) {
    return Response.json({
      title: "Foundations of nursing",
      table_of_contents: [
        { level: 0, label: "Unit 1", title: "Safety" },
        { level: 1, label: "1", title: "Infection Control" },
        { level: 0, label: "Unit 2", title: "Medications" },
        { level: 1, label: "2", title: "Cardiac Medications" },
        { level: 1, label: "3", title: "Measuring the Body" },
      ],
    });
  }
  if (url.startsWith("https://openlibrary.org/")) return Response.json({ docs: [] });
  return realFetch(input, init);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);

describe.skipIf(!POSTGREST_BIN)("Phase 2 pipeline (integration)", () => {
  let stack: Stack;
  let user: { id: string; token: string };
  let routes: {
    magic: typeof import("@/app/api/magic-ingest/route");
    books: typeof import("@/app/api/books/build-syllabus/route");
    blueprint: typeof import("@/app/api/blueprints/sync/route");
  };

  const post = (handler: (r: Request) => Promise<Response>, path: string, body: BodyInit, contentType?: string) =>
    handler(
      new Request(`http://app${path}`, {
        method: "POST",
        body,
        headers: { authorization: `Bearer ${user.token}`, ...(contentType ? { "content-type": contentType } : {}) },
      }),
    );

  beforeAll(async () => {
    stack = await startStack(POSTGREST_BIN!);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", stack.url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", stack.anonKey);
    vi.stubEnv("ANTHROPIC_API_KEY", "unused");
    vi.stubEnv("VOYAGE_API_KEY", "unused");
    user = stack.newUser();
    routes = {
      magic: await import("@/app/api/magic-ingest/route"),
      books: await import("@/app/api/books/build-syllabus/route"),
      blueprint: await import("@/app/api/blueprints/sync/route"),
    };
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await stack?.stop();
  });

  it("saves notes before any book exists, unlinked", async () => {
    const form = new FormData();
    form.append(
      "files",
      new File(["# Cardiac\n\nDigoxin: hold if apical pulse under 60. Remember this on the exam!\n\n# Safety\n\nHand hygiene before and after every client."], "pharm-notes.md", {
        type: "text/markdown",
      }),
    );
    const response = await post(routes.magic.POST, "/api/magic-ingest", form);
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.kind).toBe("notebooklm_note");
    expect(body.notes.chunksSaved).toBeGreaterThanOrEqual(1);
    expect(body.notes.stonesLinked).toBe(0);
    expect(body.message).toMatch(/link up when you add/);
    expect(stack.sql("select count(*) from note_chunks where stone_id is null")).not.toBe("0");
    expect(stack.sql("select count(*) from note_chunks where is_exam_pearl")).not.toBe("0");
  });

  it("saves a pasted missed UWorld question before its stone exists", async () => {
    const text = `${digoxinQuestion.vignette}\nA. Give the dose\nB. Hold the dose and report\nExplanation: correct answer is B. (Choice A) is incorrect.\nEducational objective: hold digoxin.`;
    const response = await post(routes.magic.POST, "/api/magic-ingest", JSON.stringify({ text }), "application/json");
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.kind).toBe("uworld_text");
    expect(body.question).toMatchObject({ missed: true, stone: null, practiceAdded: 0 });
  });

  it("builds a syllabus from an ISBN and links the earlier notes and question", async () => {
    const response = await post(routes.books.POST, "/api/books/build-syllabus", JSON.stringify({ isbn: "978-0-323-81205-4" }), "application/json");
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      status: "created",
      title: "Foundations of Nursing",
      courseId: "fundamentals",
      tocSource: "openlibrary",
      counts: { units: 2, modules: 3, stones: 4 },
    });
    expect(body.linked.notes).toBeGreaterThanOrEqual(1);
    expect(body.linked.questions).toBe(1);
    expect(body.linked.practiceAdded).toBe(2);

    expect(stack.sql("select edition from textbooks")).toBe("9th");
    expect(stack.sql("select string_agg(status::text, ',' order by s.title) from stepping_stones s")).toBe("needs_review,ready,locked,locked");
    expect(stack.sql("select count(*) from practice_items")).toBe("2");
    expect(stack.sql("select string_agg(item_type, ',' order by item_type) from practice_items")).toBe("ngn_mini_bowtie,twin_mcq");
    expect(stack.sql("select s.title from note_chunks c join stepping_stones s on s.id = c.stone_id where c.content ilike '%digoxin%'")).toBe("Digoxin safety");
  });

  it("recognizes the same book again", async () => {
    const response = await post(routes.magic.POST, "/api/magic-ingest", JSON.stringify({ text: "ISBN 9780323812054" }), "application/json");
    const body = await response.json();
    expect(body.book.status).toBe("duplicate");
    expect(body.message).toBe("Foundations of Nursing is already on your path.");
  });

  it("asks for photos when a book's chapter list can't be found", async () => {
    const calls = aiCalls.length;
    const response = await post(routes.books.POST, "/api/books/build-syllabus", JSON.stringify({ title: "Some Obscure Nursing Book" }), "application/json");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("needs_toc_photo");
    expect(body.message).toMatch(/Snap photos of its table of contents/);
    expect(aiCalls.slice(calls)).toEqual(["toc-web-search"]);
  });

  it("links a screenshot of a missed question straight to its stone and refreshes the lesson", async () => {
    const stoneId = stack.sql("select id from stepping_stones where title = 'Hand hygiene'");
    stack.sql(`insert into lessons (user_id, stone_id, cards, source_fingerprint, model) values ('${user.id}', '${stoneId}', '[]', 'old', 'test')`);

    const form = new FormData();
    form.append("files", new File([JPEG], "uworld.jpg", { type: "image/jpeg" }));
    const response = await post(routes.magic.POST, "/api/magic-ingest", form);
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.kind).toBe("uworld_screenshot");
    expect(body.question.stone.title).toBe("Hand hygiene");
    expect(body.question.practiceAdded).toBe(2);
    expect(stack.sql(`select status from stepping_stones where id = '${stoneId}'`)).toBe("needs_review");
    expect(stack.sql(`select count(*) from lessons where stone_id = '${stoneId}'`)).toBe("0");
    expect(stack.sql("select storage_path like '%/ingest/%' from ingest_items where kind = 'uworld_screenshot'")).toBe("t");
  });

  it("records a failed ingest when the input makes no sense", async () => {
    const response = await post(routes.magic.POST, "/api/magic-ingest", JSON.stringify({ text: "hey how are you doing today?" }), "application/json");
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("unknown_input");
    expect(stack.sql("select state || ':' || kind from ingest_items order by created_at desc limit 1")).toBe("failed:unknown");
  });

  it("serves the blueprint and tags untagged stones on sync", async () => {
    const get = await routes.blueprint.GET(new Request("http://app/api/blueprints/sync", { headers: { authorization: `Bearer ${user.token}` } }));
    const blueprint = await get.json();
    expect(get.status).toBe(200);
    expect(blueprint.check).toEqual({ ok: true, problems: [] });
    expect(blueprint.blueprint.clientNeeds).toHaveLength(8);
    expect(blueprint.blueprint.testPlan.id).toBe("pn-2026");

    const sync = await routes.blueprint.POST(new Request("http://app/api/blueprints/sync", { method: "POST", headers: { authorization: `Bearer ${user.token}` } }));
    const result = await sync.json();
    expect(sync.status).toBe(200);
    expect(result.stonesTagged).toBe(1);
    expect(stack.sql("select count(*) from stone_blueprint_tags t join stepping_stones s on s.id = t.stone_id where s.title = 'Taking vital signs'")).toBe("1");
  });

  it("keeps each student's data private", async () => {
    const other = stack.newUser();
    const response = await routes.blueprint.POST(new Request("http://app/api/blueprints/sync", { method: "POST", headers: { authorization: `Bearer ${other.token}` } }));
    expect((await response.json()).stonesTagged).toBe(0);
    const dup = await routes.books.POST(
      new Request("http://app/api/books/build-syllabus", {
        method: "POST",
        headers: { authorization: `Bearer ${other.token}`, "content-type": "application/json" },
        body: JSON.stringify({ isbn: "9780323812054" }),
      }),
    );
    // The other student doesn't see the first student's copy, so this builds their own.
    expect((await dup.json()).status).toBe("created");
    expect(stack.sql("select count(distinct user_id) from textbooks")).toBe("2");
  });
});
