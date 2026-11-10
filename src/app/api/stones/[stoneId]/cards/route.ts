import { z } from "zod";
import { stoneCards } from "@/lib/server/anki/decks";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> the stone's Anki cards that passed the fact-check, for review before its questions.
export const GET = route(async (request: Request, { params }: { params: Promise<{ stoneId: string }> }) => {
  const ctx = await requireUser(request);
  return json({ cards: await stoneCards(ctx, z.guid().parse((await params).stoneId)) });
});
