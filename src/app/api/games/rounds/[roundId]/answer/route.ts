import { z } from "zod";
import { answerRound } from "@/lib/server/games/rounds";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

const Ids = z.record(z.string().max(20), z.string().max(20));

const BodySchema = z.object({
  answer: z
    .object({
      match: Ids.optional(),
      bins: Ids.optional(),
      order: z.array(z.string().max(20)).max(12).optional(),
      calc: z.record(z.string().max(20), z.string().max(40)).optional(),
    })
    .refine((a) => Object.keys(a).length <= 4),
  durationMs: z.number().int().min(0).max(86400000),
});

// POST { answer, durationMs } -> the score, what was right and why, and the NCLEX-style questions that close the round.
export const POST = route(async (request: Request, { params }: { params: Promise<{ roundId: string }> }) => {
  const ctx = await requireUser(request);
  const roundId = z.guid().parse((await params).roundId);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json(await answerRound(ctx, roundId, body.answer, body.durationMs));
});
