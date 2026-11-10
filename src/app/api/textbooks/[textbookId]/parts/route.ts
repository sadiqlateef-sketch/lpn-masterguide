import { z } from "zod";
import { registerPart } from "@/lib/server/books/textbook-pdf";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const BodySchema = z.object({
  part: z.number().int(),
  parts: z.number().int(),
  bytes: z.number().int(),
  contentHash: z.string(),
});

// POST { part, parts, bytes, contentHash } -> records one part of the book's PDF.
// The phone uploads the part to the student's private Storage folder first (too big for an API request).
export const POST = route(async (request: Request, { params }: { params: Promise<{ textbookId: string }> }) => {
  const ctx = await requireUser(request);
  const textbookId = z.guid().parse((await params).textbookId);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json(await registerPart(ctx, textbookId, body), 201);
});
