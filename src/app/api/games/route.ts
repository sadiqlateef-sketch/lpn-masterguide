import { listGames } from "@/lib/server/games/rounds";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

// GET -> every game with the student's best and last score.
export const GET = route(async (request: Request) => {
  const ctx = await requireUser(request);
  return json({ games: await listGames(ctx) });
});
