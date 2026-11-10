import { AttemptBodySchema } from "@/lib/server/attempt-schema";
import { json, route } from "@/lib/server/http";
import { recordAttempt } from "@/lib/server/practice";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// POST { itemId, selected: ["B"] } or { itemId, bowtie: { condition, actions, parameters } }.
// Grades on the server, saves the attempt, and returns the right answer with its rationale.
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = AttemptBodySchema.parse(await request.json().catch(() => ({})));
  return json(await recordAttempt(ctx, body), 201);
});
