import { z } from "zod";
import { pendingSuggestions, suggestCards } from "@/lib/server/anki/suggest";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ deckId: string }> };

// GET -> suggested cards waiting on the student.
export const GET = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  return json({ suggestions: await pendingSuggestions(ctx, z.guid().parse((await params).deckId)) });
});

// POST -> suggests cards for the next few stones the deck covers thinly. Call again while stonesLeft > 0.
export const POST = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  return json(await suggestCards(ctx, z.guid().parse((await params).deckId)));
});
