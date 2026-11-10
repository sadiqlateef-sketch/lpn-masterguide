import { z } from "zod";
import { checkDeck } from "@/lib/server/anki/check";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST -> fact-checks the deck's next cards against the student's books and notes, within the deck's cap.
// The phone calls it again until nothing remains or the cap is reached.
export const POST = route(async (request: Request, { params }: { params: Promise<{ deckId: string }> }) => {
  const ctx = await requireUser(request);
  return json(await checkDeck(ctx, z.guid().parse((await params).deckId)));
});
