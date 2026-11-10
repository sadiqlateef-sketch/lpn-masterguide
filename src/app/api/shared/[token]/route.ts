import { json, route } from "@/lib/server/http";
import { openSharedDeck } from "@/lib/server/share";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

// GET -> a shared lesson or question set, with no sign-in. Questions come without their answers.
export const GET = route(async (_request: Request, { params }: Params) => {
  return json(await openSharedDeck((await params).token));
});
