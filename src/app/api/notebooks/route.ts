import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { createNotebook, listNotebooks } from "@/lib/server/notebooks";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const CreateSchema = z.object({ name: z.string(), color: z.string().optional() });

// GET -> the student's NotebookLM notebooks with how many note files each holds.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json({ notebooks: await listNotebooks(ctx) });
});

// POST { name, color? } -> a new, empty notebook.
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = CreateSchema.parse(await request.json().catch(() => ({})));
  return json(await createNotebook(ctx, body), 201);
});
