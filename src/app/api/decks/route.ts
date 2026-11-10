import { listDecks } from "@/lib/server/anki/decks";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> the student's Anki decks, with how far each has been checked.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json({ decks: await listDecks(ctx) });
});
