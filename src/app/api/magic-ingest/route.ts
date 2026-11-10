import { json, route } from "@/lib/server/http";
import { magicAdd } from "@/lib/server/ingest/router";
import { requireUser } from "@/lib/server/supabase";
import { parseUpload } from "@/lib/server/uploads";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST multipart/form-data with any of: `text`, one or more files (photos, PDFs, markdown, text),
// and an optional `courseId`. Or POST JSON { "text": "..." }.
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const upload = await parseUpload(request);
  const result = await magicAdd(ctx, upload);
  return json(result, 201);
});
