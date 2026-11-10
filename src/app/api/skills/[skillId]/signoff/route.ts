import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { setSkillSignoff } from "@/lib/server/skills";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

type Params = { params: Promise<{ skillId: string }> };

const Body = z.object({ signedOffOn: z.iso.date().nullable() });

// PUT { signedOffOn: "YYYY-MM-DD" | null } -> records the day an instructor signed the skill off, or clears it.
export const PUT = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  const skillId = z.string().regex(/^[a-z0-9_]{2,40}$/).parse((await params).skillId);
  const body = Body.parse(await request.json().catch(() => ({})));
  return json(await setSkillSignoff(ctx, skillId, body.signedOffOn));
});
