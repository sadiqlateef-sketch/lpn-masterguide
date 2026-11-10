import { z } from "zod";
import { deleteDrugCard, getDrugCard } from "@/lib/server/drug-cards";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

type Params = { params: Promise<{ cardId: string }> };

// GET -> the card with its sources and its two questions.
export const GET = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  return json(await getDrugCard(ctx, z.guid().parse((await params).cardId)));
});

// DELETE -> removes the card (its questions stay in the student's history).
export const DELETE = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  await deleteDrugCard(ctx, z.guid().parse((await params).cardId));
  return json({ ok: true });
});
