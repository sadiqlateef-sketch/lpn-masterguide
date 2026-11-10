import { z } from "zod";
import { deleteClinicalPrep, getClinicalPrep } from "@/lib/server/clinical";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

type Params = { params: Promise<{ prepId: string }> };

// GET -> the prep sheet with its sources and questions.
export const GET = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  return json(await getClinicalPrep(ctx, z.guid().parse((await params).prepId)));
});

// DELETE -> removes the sheet (care plans made from it stay).
export const DELETE = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  await deleteClinicalPrep(ctx, z.guid().parse((await params).prepId));
  return json({ ok: true });
});
