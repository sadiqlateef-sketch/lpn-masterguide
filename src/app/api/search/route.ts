import { json, route } from "@/lib/server/http";
import { searchStudy } from "@/lib/server/search";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET ?q= -> stones, notes, textbook passages and saved questions that match, by meaning and by words.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const q = new URL(request.url).searchParams.get("q");
  return json({ results: await searchStudy(ctx, q) });
});
