import { z } from "zod";

// The answer part of a practice question's body, shared by Quick Play, exams and share links.
const AnswerShape = z.object({
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
});

const hasAnswer = (b: z.infer<typeof AnswerShape>) => Boolean(b.selected || b.bowtie || b.matrix || b.cloze || b.order);

export const AttemptBodySchema = AnswerShape.extend({ itemId: z.guid() }).refine(hasAnswer, { message: "Send an answer" });

// A question on a share link is numbered within its set ("q1", "q2"...), never by its real id.
export const SharedAttemptSchema = AnswerShape.extend({ itemId: z.string().regex(/^q\d{1,3}$/) }).refine(hasAnswer, { message: "Send an answer" });
