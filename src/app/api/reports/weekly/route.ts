import { json, route } from "@/lib/server/http";
import { loadWeeklyReports } from "@/lib/server/planner";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> { lastWeek, thisWeek }: minutes, questions, what was mastered and what slipped, and next week's focus.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json(await loadWeeklyReports(ctx));
});
