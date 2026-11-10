import { z } from "zod";
import { askAboutCard } from "@/lib/server/ask";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

const BodySchema = z.object({ stoneId: z.guid(), cardId: z.string().min(1).max(40), question: z.string() });

// POST { stoneId, cardId, question } -> a short answer from the stone's own sources, with the sources named.
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json(await askAboutCard(ctx, body), 201);
});
