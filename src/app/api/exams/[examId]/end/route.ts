import { z } from "zod";
import { endExam } from "@/lib/server/exams";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// POST -> ends the exam early and returns the summary.
export const POST = route(async (request: Request, { params }: { params: Promise<{ examId: string }> }) => {
  const ctx = await requireUser(request);
  return json(await endExam(ctx, z.guid().parse((await params).examId)));
});
