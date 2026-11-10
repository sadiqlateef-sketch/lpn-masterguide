import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { getProfile, saveProfile } from "@/lib/server/planner";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const BodySchema = z.object({
  nclexDate: z.string().max(10).nullable().optional(),
  hesiDate: z.string().max(10).nullable().optional(),
  reminderTime: z.string().max(8).nullable().optional(),
  timezone: z.string().max(64).optional(),
  reviewBufferDays: z.number().int().optional(),
});

// GET -> the student's exam dates, reminder time and time zone (defaults until saved).
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json(await getProfile(ctx));
});

// PUT { nclexDate?, hesiDate?, reminderTime?, timezone?, reviewBufferDays? } -> the saved profile. Fields left out stay as they are.
export const PUT = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json(await saveProfile(ctx, body));
});
