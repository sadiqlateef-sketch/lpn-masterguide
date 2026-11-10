import { z } from "zod";
import { decideCheck } from "@/lib/server/anki/check";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const BodySchema = z.object({ decision: z.enum(["accepted", "dismissed"]) });

// POST { decision } -> accepting applies the correction (keeping the original) or suspends the card; dismissing changes nothing.
export const POST = route(async (request: Request, { params }: { params: Promise<{ checkId: string }> }) => {
  const ctx = await requireUser(request);
  const checkId = z.guid().parse((await params).checkId);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json(await decideCheck(ctx, checkId, body.decision));
});
