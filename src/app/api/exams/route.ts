import { z } from "zod";
import { recentExams, startExam } from "@/lib/server/exams";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> the last ten practice exams.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json({ exams: await recentExams(ctx) });
});

// POST { length: "short" | "long" } -> a new adaptive exam with its first question.
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = z.object({ length: z.enum(["short", "long"]) }).parse(await request.json().catch(() => ({})));
  return json(await startExam(ctx, body.length), 201);
});
