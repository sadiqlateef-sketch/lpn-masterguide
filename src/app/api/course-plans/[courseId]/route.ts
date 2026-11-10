import { z } from "zod";
import { COURSE_IDS } from "@/lib/blueprint-ids";
import { getCoursePlan } from "@/lib/server/course-plan";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> the course's newest plan with this week's questions, or { plan: null } before the first one.
// `stale` is true when a source was added or removed since the plan was drafted.
export const GET = route(async (request: Request, { params }: { params: Promise<{ courseId: string }> }) => {
  const ctx = await requireUser(request);
  const courseId = z.enum(COURSE_IDS).parse((await params).courseId);
  return json({ plan: await getCoursePlan(ctx, courseId) });
});
