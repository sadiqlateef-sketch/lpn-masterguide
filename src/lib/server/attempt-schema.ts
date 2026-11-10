import { z } from "zod";

// The body of an answer to a practice question, shared by Quick Play and exams.
export const AttemptBodySchema = z
  .object({
    itemId: z.guid(),
    selected: z.array(z.string().max(20)).max(16).optional(),
    bowtie: z
      .object({
        condition: z.string().max(20),
        actions: z.array(z.string().max(20)).max(10),
        parameters: z.array(z.string().max(20)).max(10),
      })
      .optional(),
    matrix: z.record(z.string().max(20), z.string().max(20)).optional(),
    cloze: z.record(z.string().max(20), z.string().max(20)).optional(),
    order: z.array(z.string().max(20)).max(12).optional(),
  })
  .refine((b) => b.selected || b.bowtie || b.matrix || b.cloze || b.order, { message: "Send an answer" });
