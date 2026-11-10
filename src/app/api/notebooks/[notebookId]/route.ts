import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { deleteNotebook, updateNotebook } from "@/lib/server/notebooks";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

type Params = { params: Promise<{ notebookId: string }> };

const PatchSchema = z.object({ name: z.string().optional(), color: z.string().optional() });

// PATCH { name?, color? } -> renames or recolors a notebook.
export const PATCH = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  const id = z.guid().parse((await params).notebookId);
  const body = PatchSchema.parse(await request.json().catch(() => ({})));
  return json(await updateNotebook(ctx, id, body));
});

// DELETE -> removes the notebook and the notes in it; lessons that quoted them rebuild.
export const DELETE = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  const id = z.guid().parse((await params).notebookId);
  return json(await deleteNotebook(ctx, id));
});
