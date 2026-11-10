import { checkBlueprint, loadBlueprint, syncStudentPath } from "@/lib/server/blueprint";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET: the NCLEX-PN test plan, NGN steps, HESI domains and score bands from the seed tables, plus a consistency check.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const blueprint = await loadBlueprint(ctx);
  return json({ blueprint, check: checkBlueprint(blueprint) });
});

// POST: tags any untagged stepping stones and links notes and questions that arrived before their stone existed.
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const result = await syncStudentPath(ctx);
  return json(result, result.check.ok ? 200 : 500);
});
