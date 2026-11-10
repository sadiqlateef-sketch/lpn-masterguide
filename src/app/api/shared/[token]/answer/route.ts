import { SharedAttemptSchema } from "@/lib/server/attempt-schema";
import { json, route } from "@/lib/server/http";
import { gradeSharedAnswer } from "@/lib/server/share";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

// POST { itemId: "q1", selected: ["B"] } -> checks one answer on a shared set. No sign-in, and nothing is saved.
export const POST = route(async (request: Request, { params }: Params) => {
  const body = SharedAttemptSchema.parse(await request.json().catch(() => ({})));
  return json(await gradeSharedAnswer((await params).token, body));
});
