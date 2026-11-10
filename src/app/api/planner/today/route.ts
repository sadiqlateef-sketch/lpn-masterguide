import { json, route } from "@/lib/server/http";
import { loadToday } from "@/lib/server/planner";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET ?tz=America/New_York -> today's plan: reviews due, stones to learn, a question goal, the streak and the pace.
// The phone's time zone is saved only while the student has no planner profile yet.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const tz = new URL(request.url).searchParams.get("tz");
  return json(await loadToday(ctx, tz && tz.length <= 64 ? tz : null));
});
