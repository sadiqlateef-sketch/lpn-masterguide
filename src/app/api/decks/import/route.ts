import { z } from "zod";
import { importDeck } from "@/lib/server/anki/decks";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = z.union([
  z.object({ storagePath: z.string().min(1).max(300), fileName: z.string().max(200).nullable().default(null) }),
  z.object({ text: z.string().min(1), fileName: z.string().max(200).nullable().default(null) }),
]);

// POST { storagePath, fileName } after the phone uploads a deck file to the student's private folder,
// or { text } with a plain-text export. Reads the cards and files each under its closest stone.
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json(await importDeck(ctx, body), 201);
});
