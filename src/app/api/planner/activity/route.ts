import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { logMinutes } from "@/lib/server/planner";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const BodySchema = z.object({ minutes: z.number() });

// POST { minutes } -> adds study minutes (from a lesson or a round) to today.
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json(await logMinutes(ctx, body.minutes));
});
