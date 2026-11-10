import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { deleteNoteSource } from "@/lib/server/ingest/notes";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// DELETE -> removes one saved note file and refreshes the lessons that used it.
export const DELETE = route(async (request: Request, { params }: { params: Promise<{ sourceId: string }> }) => {
  const ctx = await requireUser(request);
  const sourceId = z.guid().parse((await params).sourceId);
  return json(await deleteNoteSource(ctx, sourceId));
});
