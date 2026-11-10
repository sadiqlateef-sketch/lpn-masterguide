import { json, route } from "@/lib/server/http";
import { listSkills } from "@/lib/server/skills";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> every skills checklist with the student's last run and sign-off.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json({ skills: await listSkills(ctx) });
});
