import { NextResponse, type NextRequest } from "next/server";
import { decideCors } from "@/lib/server/cors";

// Lets the Android app (which runs its screens from https://localhost) call the API.
export function middleware(request: NextRequest) {
  const decision = decideCors(request.method, request.headers.get("origin"), request.nextUrl.origin);
  if (decision.kind === "preflight") return new NextResponse(null, { status: decision.status, headers: decision.headers });
  const response = NextResponse.next();
  if (decision.kind === "pass") for (const [key, value] of Object.entries(decision.headers)) response.headers.set(key, value);
  return response;
}

export const config = { matcher: "/api/:path*" };
