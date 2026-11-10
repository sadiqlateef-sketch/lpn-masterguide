import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { createShareLink, listShareLinks } from "@/lib/server/share";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET -> the student's share links, newest first (turned-off and run-out ones included).
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json({ links: await listShareLinks(ctx) });
});

// POST { kind: "lesson" | "questions", stoneId } -> a read-only link to a copy of that lesson or question set.
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const body = z.object({ kind: z.enum(["lesson", "questions"]), stoneId: z.guid() }).parse(await request.json().catch(() => ({})));
  return json(await createShareLink(ctx, body.kind, body.stoneId), 201);
});
