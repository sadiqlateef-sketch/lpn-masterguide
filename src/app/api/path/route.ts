import { json, route } from "@/lib/server/http";
import { loadPath } from "@/lib/server/progress";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> the student's stepping-stone map, grouped by course, in study order.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json(await loadPath(ctx));
});
