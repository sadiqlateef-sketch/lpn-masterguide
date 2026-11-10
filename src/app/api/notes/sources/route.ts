import { json, route } from "@/lib/server/http";
import { listNoteSources } from "@/lib/server/ingest/notes";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> the student's saved notes, including the folder path and content hash of synced files.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json({ sources: await listNoteSources(ctx) });
});
