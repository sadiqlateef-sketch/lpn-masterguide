import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { recordAttempt } from "@/lib/server/practice";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const BodySchema = z
  .object({
    itemId: z.guid(),
    selected: z.array(z.string().max(20)).max(10).optional(),
    bowtie: z
      .object({
        condition: z.string().max(20),
        actions: z.array(z.string().max(20)).max(10),
        parameters: z.array(z.string().max(20)).max(10),
      })
      .optional(),
  })
  .refine((b) => b.selected || b.bowtie, { message: "Send selected or bowtie" });

// POST { itemId, selected: ["B"] } or { itemId, bowtie: { condition, actions, parameters } }.
// Grades on the server, saves the attempt, and returns the right answer with its rationale.
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json(await recordAttempt(ctx, body), 201);
});
