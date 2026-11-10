// Cross-origin rules for the API. The Android app serves its screens from https://localhost inside
// the phone and calls the hosted API, so the browser treats every call as cross-origin. Only the
// app's own origins are allowed; auth still comes from the Bearer token, never from cookies.

export const DEFAULT_ALLOWED_ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost"] as const;

export function allowedOrigins(env: string | undefined = process.env.CORS_ALLOWED_ORIGINS): string[] {
  const extra = (env ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra])];
}

export function isAllowedOrigin(origin: string | null, allowed: readonly string[] = allowedOrigins()): origin is string {
  return origin !== null && allowed.includes(origin.replace(/\/+$/, ""));
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export type CorsDecision =
  | { kind: "same-origin" } // no Origin header or same site: nothing to add
  | { kind: "preflight"; status: 204 | 403; headers: Record<string, string> }
  | { kind: "pass"; headers: Record<string, string> };

// Decides how to treat a request. `selfOrigin` is the API's own origin, which never needs CORS headers.
export function decideCors(method: string, origin: string | null, selfOrigin: string, allowed: readonly string[] = allowedOrigins()): CorsDecision {
  if (origin === null || origin === selfOrigin) {
    return method === "OPTIONS" ? { kind: "preflight", status: 204, headers: {} } : { kind: "same-origin" };
  }
  const ok = isAllowedOrigin(origin, allowed);
  if (method === "OPTIONS") return ok ? { kind: "preflight", status: 204, headers: corsHeaders(origin) } : { kind: "preflight", status: 403, headers: { Vary: "Origin" } };
  // A disallowed origin still reaches the route, but without CORS headers the browser hides the answer.
  return { kind: "pass", headers: ok ? corsHeaders(origin) : { Vary: "Origin" } };
}
