import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { revokeShareLink } from "@/lib/server/share";
import { requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

type Params = { params: Promise<{ shareId: string }> };

// DELETE -> turns the link off; anyone who opens it after this sees that it has ended.
export const DELETE = route(async (request: Request, { params }: Params) => {
  const ctx = await requireUser(request);
  return json(await revokeShareLink(ctx, z.guid().parse((await params).shareId)));
});
