import { z } from "zod";
import { GAME_IDS } from "@/lib/api-types";
import { startRound } from "@/lib/server/games/rounds";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

const BodySchema = z.object({ stoneIds: z.array(z.guid()).max(5).optional() });

// POST { stoneIds? } -> a new round of the game, without its answers.
export const POST = route(async (request: Request, { params }: { params: Promise<{ game: string }> }) => {
  const ctx = await requireUser(request);
  const game = z.enum(GAME_IDS).parse((await params).game);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json(await startRound(ctx, game, body.stoneIds), 201);
});
