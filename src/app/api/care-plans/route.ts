import { z } from "zod";
import { createCarePlan, listCarePlans } from "@/lib/server/clinical";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({ situation: z.string().trim().min(10).max(2000), prepId: z.guid().nullable().optional() });

// GET -> the student's care plans, last edited first.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json({ plans: await listCarePlans(ctx) });
});

// POST { situation, prepId? } -> a draft plan in LPN scope for the student to edit.
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = Body.parse(await request.json().catch(() => ({})));
  return json(await createCarePlan(ctx, body.situation, body.prepId ?? null), 201);
});
