import { z } from "zod";
import { decideSuggestion } from "@/lib/server/anki/suggest";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const BodySchema = z.object({ decision: z.enum(["accepted", "dismissed"]) });

// POST { decision } -> accepting adds the suggested card to the deck under its stone.
export const POST = route(async (request: Request, { params }: { params: Promise<{ suggestionId: string }> }) => {
  const ctx = await requireUser(request);
  const suggestionId = z.guid().parse((await params).suggestionId);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json(await decideSuggestion(ctx, suggestionId, body.decision));
});
