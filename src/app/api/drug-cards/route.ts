import { z } from "zod";
import { createDrugCard, listDrugCards } from "@/lib/server/drug-cards";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET -> the student's drug cards, A to Z.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json({ cards: await listDrugCards(ctx) });
});

// POST { name } -> a card for that medication (the existing one if it's already made).
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = z.object({ name: z.string().trim().min(2).max(80) }).parse(await request.json().catch(() => ({})));
  return json(await createDrugCard(ctx, body.name), 201);
});
