import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { getLesson } from "@/lib/server/lessons";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = z.object({
  stoneId: z.guid(),
  refresh: z.boolean().optional(),
});

// POST { stoneId, refresh? } -> the stone's 5-card story deck and its Quick Play questions.
// Reuses the saved deck unless the stone's notes, questions or tags changed (or refresh is true).
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json(await getLesson(ctx, body.stoneId, { refresh: body.refresh }));
});
