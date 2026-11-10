import { z } from "zod";
import { answerExam } from "@/lib/server/exams";
import { AttemptBodySchema } from "@/lib/server/attempt-schema";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// POST { itemId, ...answer } -> grades the current question, then returns the next one (or the summary).
export const POST = route(async (request: Request, { params }: { params: Promise<{ examId: string }> }) => {
  const ctx = await requireUser(request);
  const examId = z.guid().parse((await params).examId);
  const body = AttemptBodySchema.parse(await request.json().catch(() => ({})));
  return json(await answerExam(ctx, examId, body));
});
