import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { completeStone } from "@/lib/server/progress";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// POST after Quick Play. Scores the lesson's questions from saved attempts, masters the stone at 80%,
// and opens the next stone on the path.
export const POST = route(async (request: Request, { params }: { params: Promise<{ stoneId: string }> }) => {
  const ctx = await requireUser(request);
  const stoneId = z.guid().parse((await params).stoneId);
  return json(await completeStone(ctx, stoneId));
});
