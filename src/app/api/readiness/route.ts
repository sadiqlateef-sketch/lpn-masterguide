import { json, route } from "@/lib/server/http";
import { loadReadiness } from "@/lib/server/progress";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> NCLEX-PN readiness %, HESI projection, per-category accuracy and stones to review.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json(await loadReadiness(ctx));
});
