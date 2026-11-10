import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { saveMistakeNote } from "@/lib/server/mistakes";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// PUT { note } -> saves the student's note on a missed question (an empty note removes it).
export const PUT = route(async (request: Request, { params }: { params: Promise<{ itemId: string }> }) => {
  const ctx = await requireUser(request);
  const itemId = z.guid().parse((await params).itemId);
  const body = z.object({ note: z.string().max(1000) }).parse(await request.json().catch(() => ({})));
  return json(await saveMistakeNote(ctx, itemId, body.note));
});
