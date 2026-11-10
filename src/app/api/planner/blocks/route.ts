import { z } from "zod";
import { COURSE_IDS } from "@/lib/blueprint-ids";
import { json, route } from "@/lib/server/http";
import { getBlocks, MAX_BLOCKS, saveBlocks } from "@/lib/server/planner";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const BlockSchema = z.object({
  weekday: z.number().int(),
  start: z.string().max(8),
  minutes: z.number().int(),
  courseId: z.enum(COURSE_IDS).nullable(),
});
const BodySchema = z.object({ blocks: z.array(BlockSchema).max(MAX_BLOCKS) });

// GET -> { blocks }: the week's study times.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json({ blocks: await getBlocks(ctx) });
});

// PUT { blocks } -> { blocks }: replaces the whole week.
export const PUT = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json({ blocks: await saveBlocks(ctx, body.blocks) });
});
