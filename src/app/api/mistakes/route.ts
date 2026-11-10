import { json, route } from "@/lib/server/http";
import { listMistakes } from "@/lib/server/mistakes";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> questions whose latest answer was wrong, newest first, with the student's notes.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json({ mistakes: await listMistakes(ctx) });
});
