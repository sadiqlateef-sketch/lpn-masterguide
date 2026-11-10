import { z } from "zod";
import { COURSE_IDS } from "@/lib/blueprint-ids";
import { generateCoursePlan } from "@/lib/server/course-plan";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = z.object({ courseId: z.enum(COURSE_IDS), force: z.boolean().optional() });

// POST { courseId, force? } -> drafts the course's weekly plan from its stones and sources.
// Returns the newest plan as is when no source changed since it was drafted (unless force is true).
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = BodySchema.parse(await request.json().catch(() => ({})));
  return json({ plan: await generateCoursePlan(ctx, body.courseId, { force: body.force }) });
});
