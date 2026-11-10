import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as blueprintGet, POST as blueprintPost } from "@/app/api/blueprints/sync/route";
import { POST as buildSyllabus } from "@/app/api/books/build-syllabus/route";
import { POST as lessonGenerate } from "@/app/api/lessons/generate/route";
import { POST as magicIngest } from "@/app/api/magic-ingest/route";
import { DELETE as noteSourceDelete } from "@/app/api/notes/sources/[sourceId]/route";
import { GET as noteSources } from "@/app/api/notes/sources/route";
import { GET as pathGet } from "@/app/api/path/route";
import { POST as practiceAttempt } from "@/app/api/practice/attempt/route";
import { GET as readinessGet } from "@/app/api/readiness/route";
import { POST as stoneComplete } from "@/app/api/stones/[stoneId]/complete/route";
import { GET as planGet } from "@/app/api/course-plans/[courseId]/route";
import { POST as planGenerate } from "@/app/api/course-plans/generate/route";
import { POST as lessonAsk } from "@/app/api/lessons/ask/route";
import { DELETE as notebookDelete, PATCH as notebookPatch } from "@/app/api/notebooks/[notebookId]/route";
import { GET as notebooksGet, POST as notebooksPost } from "@/app/api/notebooks/route";
import { GET as searchGet } from "@/app/api/search/route";
import { POST as textbookParts } from "@/app/api/textbooks/[textbookId]/parts/route";
import { POST as textbookProcess } from "@/app/api/textbooks/[textbookId]/process/route";
import { GET as textbooksGet } from "@/app/api/textbooks/route";
import { POST as plannerActivity } from "@/app/api/planner/activity/route";
import { GET as blocksGet, PUT as blocksPut } from "@/app/api/planner/blocks/route";
import { GET as profileGet, PUT as profilePut } from "@/app/api/planner/profile/route";
import { GET as todayGet } from "@/app/api/planner/today/route";
import { GET as weeklyGet } from "@/app/api/reports/weekly/route";
import { POST as reviewPost } from "@/app/api/reviews/[stoneId]/route";
import { GET as gamesGet } from "@/app/api/games/route";
import { POST as gameRound } from "@/app/api/games/[game]/round/route";
import { POST as gameAnswer } from "@/app/api/games/rounds/[roundId]/answer/route";
import { GET as examsGet, POST as examsPost } from "@/app/api/exams/route";
import { GET as examGet } from "@/app/api/exams/[examId]/route";
import { POST as examAnswer } from "@/app/api/exams/[examId]/answer/route";
import { POST as examEnd } from "@/app/api/exams/[examId]/end/route";
import { GET as drugCardsGet, POST as drugCardsPost } from "@/app/api/drug-cards/route";
import { DELETE as drugCardDelete, GET as drugCardGet } from "@/app/api/drug-cards/[cardId]/route";
import { GET as mistakesGet } from "@/app/api/mistakes/route";
import { PUT as mistakeNote } from "@/app/api/mistakes/[itemId]/note/route";
import { GET as ngnGet, POST as ngnPost } from "@/app/api/stones/[stoneId]/ngn/route";

const ID = "6f1c2c1e-4c7b-4a4e-9a51-0c6f3a1d2b7e";
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const handlers = [
  ["magic-ingest", () => magicIngest(new Request("http://x/api/magic-ingest", { method: "POST", body: JSON.stringify({ text: "x" }), headers: { "content-type": "application/json" } }))],
  ["build-syllabus", () => buildSyllabus(new Request("http://x/api/books/build-syllabus", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }))],
  ["blueprints GET", () => blueprintGet(new Request("http://x/api/blueprints/sync"))],
  ["blueprints POST", () => blueprintPost(new Request("http://x/api/blueprints/sync", { method: "POST" }))],
  ["lessons/generate", () => lessonGenerate(new Request("http://x/api/lessons/generate", json({ stoneId: ID })))],
  ["practice/attempt", () => practiceAttempt(new Request("http://x/api/practice/attempt", json({ itemId: ID, selected: ["A"] })))],
  ["stones/complete", () => stoneComplete(new Request(`http://x/api/stones/${ID}/complete`, { method: "POST" }), { params: Promise.resolve({ stoneId: ID }) })],
  ["readiness", () => readinessGet(new Request("http://x/api/readiness"))],
  ["path", () => pathGet(new Request("http://x/api/path"))],
  ["notes/sources GET", () => noteSources(new Request("http://x/api/notes/sources"))],
  ["notes/sources DELETE", () => noteSourceDelete(new Request(`http://x/api/notes/sources/${ID}`, { method: "DELETE" }), { params: Promise.resolve({ sourceId: ID }) })],
  ["notebooks GET", () => notebooksGet(new Request("http://x/api/notebooks"))],
  ["notebooks POST", () => notebooksPost(new Request("http://x/api/notebooks", json({ name: "Pharm" })))],
  ["notebooks PATCH", () => notebookPatch(new Request(`http://x/api/notebooks/${ID}`, { ...json({ name: "x" }), method: "PATCH" }), { params: Promise.resolve({ notebookId: ID }) })],
  ["notebooks DELETE", () => notebookDelete(new Request(`http://x/api/notebooks/${ID}`, { method: "DELETE" }), { params: Promise.resolve({ notebookId: ID }) })],
  ["textbooks GET", () => textbooksGet(new Request("http://x/api/textbooks"))],
  ["textbooks parts", () => textbookParts(new Request(`http://x/api/textbooks/${ID}/parts`, json({ part: 1, parts: 1, bytes: 10, contentHash: "a".repeat(64) })), { params: Promise.resolve({ textbookId: ID }) })],
  ["textbooks process", () => textbookProcess(new Request(`http://x/api/textbooks/${ID}/process`, json({ part: 1 })), { params: Promise.resolve({ textbookId: ID }) })],
  ["course-plans GET", () => planGet(new Request("http://x/api/course-plans/pharmacology"), { params: Promise.resolve({ courseId: "pharmacology" }) })],
  ["course-plans generate", () => planGenerate(new Request("http://x/api/course-plans/generate", json({ courseId: "pharmacology" })))],
  ["lessons/ask", () => lessonAsk(new Request("http://x/api/lessons/ask", json({ stoneId: ID, cardId: "eli10", question: "Why?" })))],
  ["search", () => searchGet(new Request("http://x/api/search?q=digoxin"))],
  ["planner/profile GET", () => profileGet(new Request("http://x/api/planner/profile"))],
  ["planner/profile PUT", () => profilePut(new Request("http://x/api/planner/profile", { ...json({ nclexDate: "2027-03-01" }), method: "PUT" }))],
  ["planner/blocks GET", () => blocksGet(new Request("http://x/api/planner/blocks"))],
  ["planner/blocks PUT", () => blocksPut(new Request("http://x/api/planner/blocks", { ...json({ blocks: [] }), method: "PUT" }))],
  ["planner/today", () => todayGet(new Request("http://x/api/planner/today?tz=America/New_York"))],
  ["planner/activity", () => plannerActivity(new Request("http://x/api/planner/activity", json({ minutes: 10 })))],
  ["reviews", () => reviewPost(new Request(`http://x/api/reviews/${ID}`, json({ startedAt: new Date().toISOString() })), { params: Promise.resolve({ stoneId: ID }) })],
  ["reports/weekly", () => weeklyGet(new Request("http://x/api/reports/weekly"))],
  ["games GET", () => gamesGet(new Request("http://x/api/games"))],
  ["games round", () => gameRound(new Request("http://x/api/games/scope/round", json({})), { params: Promise.resolve({ game: "scope" }) })],
  ["games answer", () => gameAnswer(new Request(`http://x/api/games/rounds/${ID}/answer`, json({ answer: {}, durationMs: 1 })), { params: Promise.resolve({ roundId: ID }) })],
  ["exams GET", () => examsGet(new Request("http://x/api/exams"))],
  ["exams POST", () => examsPost(new Request("http://x/api/exams", json({ length: "short" })))],
  ["exam GET", () => examGet(new Request(`http://x/api/exams/${ID}`), { params: Promise.resolve({ examId: ID }) })],
  ["exam answer", () => examAnswer(new Request(`http://x/api/exams/${ID}/answer`, json({ itemId: ID, selected: ["A"] })), { params: Promise.resolve({ examId: ID }) })],
  ["exam end", () => examEnd(new Request(`http://x/api/exams/${ID}/end`, { method: "POST" }), { params: Promise.resolve({ examId: ID }) })],
  ["drug-cards GET", () => drugCardsGet(new Request("http://x/api/drug-cards"))],
  ["drug-cards POST", () => drugCardsPost(new Request("http://x/api/drug-cards", json({ name: "digoxin" })))],
  ["drug-card GET", () => drugCardGet(new Request(`http://x/api/drug-cards/${ID}`), { params: Promise.resolve({ cardId: ID }) })],
  ["drug-card DELETE", () => drugCardDelete(new Request(`http://x/api/drug-cards/${ID}`, { method: "DELETE" }), { params: Promise.resolve({ cardId: ID }) })],
  ["mistakes", () => mistakesGet(new Request("http://x/api/mistakes"))],
  ["mistake note", () => mistakeNote(new Request(`http://x/api/mistakes/${ID}/note`, { ...json({ note: "x" }), method: "PUT" }), { params: Promise.resolve({ itemId: ID }) })],
  ["stone NGN GET", () => ngnGet(new Request(`http://x/api/stones/${ID}/ngn`), { params: Promise.resolve({ stoneId: ID }) })],
  ["stone NGN POST", () => ngnPost(new Request(`http://x/api/stones/${ID}/ngn`, { method: "POST" }), { params: Promise.resolve({ stoneId: ID }) })],
] as const;

describe("API routes", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(handlers)("%s asks the student to sign in when there is no token", async (_name, call) => {
    const response = await call();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthorized", message: "Please sign in first." } });
  });

  it("reports missing server keys without leaking which one", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await magicIngest(
      new Request("http://x/api/magic-ingest", { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: "{}" }),
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("server_config");
    expect(body.error.message).not.toMatch(/SUPABASE/);
    errors.mockRestore();
  });
});
