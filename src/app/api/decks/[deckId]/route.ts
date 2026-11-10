import { z } from "zod";
import { MAX_CHECK_CAP, deckView, deleteDeck, setCheckCap } from "@/lib/server/anki/decks";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

type Params = { params: Promise<{ deckId: string }> };

export const GET = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  return json(await deckView(ctx, z.guid().parse((await params).deckId)));
});

const BodySchema = z.object({ checkCap: z.number().int().min(0).max(MAX_CHECK_CAP) });

// PUT { checkCap } -> raises (or lowers) how many cards may be fact-checked.
export const PUT = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  const deckId = z.guid().parse((await params).deckId);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json(await setCheckCap(ctx, deckId, body.checkCap));
});

export const DELETE = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  await deleteDeck(ctx, z.guid().parse((await params).deckId));
  return json({ deleted: true });
});
