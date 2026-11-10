import { ClinicalInputSchema, createClinicalPrep, listClinicalPreps } from "@/lib/server/clinical";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET -> the student's clinical prep sheets, newest first.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json({ preps: await listClinicalPreps(ctx) });
});

// POST { title, clinicalOn, diagnoses, medications, skills, focus } -> a prep sheet that ends with questions.
// Anything that looks like a client identifier is refused before it reaches the model.
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = ClinicalInputSchema.parse(await request.json().catch(() => ({})));
  return json(await createClinicalPrep(ctx, body), 201);
});
