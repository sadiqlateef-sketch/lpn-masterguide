import { z } from "zod";
import { checkCarePlan } from "@/lib/server/clinical";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ planId: string }> };

// POST -> feedback on the saved plan (scope flags included) and two questions to close it.
export const POST = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  return json(await checkCarePlan(ctx, z.guid().parse((await params).planId)));
});
