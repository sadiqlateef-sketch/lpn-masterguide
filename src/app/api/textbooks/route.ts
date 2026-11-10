import { listTextbooks } from "@/lib/server/books/textbook-pdf";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> the books on the student's path, with how much of each book's PDF has been read.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json({ textbooks: await listTextbooks(ctx) });
});
