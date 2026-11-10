import { z } from "zod";
import { examState } from "@/lib/server/exams";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> where the exam stands, with the current question if it's still running.
export const GET = route(async (request: Request, { params }: { params: Promise<{ examId: string }> }) => {
  const ctx = await requireUser(request);
  return json(await examState(ctx, z.guid().parse((await params).examId)));
});
