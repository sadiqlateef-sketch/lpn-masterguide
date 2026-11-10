import { z } from "zod";
import { CarePlanSchema, deleteCarePlan, getCarePlan, updateCarePlan } from "@/lib/server/clinical";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

type Params = { params: Promise<{ planId: string }> };

// GET -> the plan, its last check and the questions so far.
export const GET = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  return json(await getCarePlan(ctx, z.guid().parse((await params).planId)));
});

// PUT { problems } -> saves the student's edits.
export const PUT = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  const id = z.guid().parse((await params).planId);
  const body = CarePlanSchema.parse(await request.json().catch(() => ({})));
  return json(await updateCarePlan(ctx, id, body.problems));
});

// DELETE -> removes the plan.
export const DELETE = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  await deleteCarePlan(ctx, z.guid().parse((await params).planId));
  return json({ ok: true });
});
