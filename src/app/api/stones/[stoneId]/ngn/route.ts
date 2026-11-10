import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { generateNgnItems, stoneNgnItems } from "@/lib/server/ngn";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ stoneId: string }> };

// GET -> the stone's NGN items (matrix, cloze, highlight, ordered response).
export const GET = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  return json({ items: await stoneNgnItems(ctx, z.guid().parse((await params).stoneId)) });
});

// POST -> writes four more from the student's sources and returns them all.
export const POST = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  return json({ items: await generateNgnItems(ctx, z.guid().parse((await params).stoneId)) }, 201);
});
