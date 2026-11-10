import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { recordReview } from "@/lib/server/planner";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const BodySchema = z.object({ startedAt: z.iso.datetime() });

// POST { startedAt } after a review round of a mastered stone. Grades the answers given since the round started,
// schedules the next review, and flags the stone for relearning after a miss.
export const POST = route(async (request: Request, { params }: { params: Promise<{ stoneId: string }> }) => {
  const ctx = await requireUser(request);
  const stoneId = z.guid().parse((await params).stoneId);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json(await recordReview(ctx, stoneId, new Date(body.startedAt)));
});
