import { z } from "zod";
import { processPart } from "@/lib/server/books/textbook-pdf";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = z.object({ part: z.number().int().min(1) });

// POST { part } -> reads one uploaded part: passages with page numbers, embedded and linked to stones.
// Parts are read in order so page numbers line up; reading a part again is a no-op once it's done.
export const POST = route(async (request: Request, { params }: { params: Promise<{ textbookId: string }> }) => {
  const ctx = await requireUser(request);
  const textbookId = z.guid().parse((await params).textbookId);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json(await processPart(ctx, textbookId, body.part));
});
