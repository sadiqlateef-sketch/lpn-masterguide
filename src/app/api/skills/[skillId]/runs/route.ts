import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { recordSkillRun } from "@/lib/server/skills";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

type Params = { params: Promise<{ skillId: string }> };

const Body = z.object({
  done: z.array(z.number().int().min(1).max(60)).max(60),
  confidence: z.enum(["not_yet", "with_help", "on_my_own"]),
});

// POST { done: step numbers ticked, confidence } -> the saved run, any critical steps missed, and the questions.
export const POST = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  const skillId = z.string().regex(/^[a-z0-9_]{2,40}$/).parse((await params).skillId);
  const body = Body.parse(await request.json().catch(() => ({})));
  return json(await recordSkillRun(ctx, skillId, body.done, body.confidence), 201);
});
