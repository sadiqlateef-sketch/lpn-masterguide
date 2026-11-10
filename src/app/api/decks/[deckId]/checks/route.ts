import { z } from "zod";
import { deckChecks } from "@/lib/server/anki/check";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> the flags waiting on the student, and a count of each verdict.
export const GET = route(async (request: Request, { params }: { params: Promise<{ deckId: string }> }) => {
  const ctx = await requireUser(request);
  return json(await deckChecks(ctx, z.guid().parse((await params).deckId)));
});
