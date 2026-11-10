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
