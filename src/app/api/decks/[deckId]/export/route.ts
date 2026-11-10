import { z } from "zod";
import { exportDeck } from "@/lib/server/anki/decks";
import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> the deck as an .apkg file for Anki, with accepted corrections and added cards.
export const GET = route(async (request: Request, { params }: { params: Promise<{ deckId: string }> }) => {
  const ctx = await requireUser(request);
  const { fileName, bytes } = await exportDeck(ctx, z.guid().parse((await params).deckId));
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="deck.apkg"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "cache-control": "no-store",
    },
  });
});
