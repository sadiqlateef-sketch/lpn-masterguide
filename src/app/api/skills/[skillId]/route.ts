import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { getSkill } from "@/lib/server/skills";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

type Params = { params: Promise<{ skillId: string }> };

const SKILL_ID = z.string().regex(/^[a-z0-9_]{2,40}$/);

// GET -> the checklist's steps, the student's recent runs, the sign-off and the two closing questions.
export const GET = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  return json(await getSkill(ctx, SKILL_ID.parse((await params).skillId)));
});
