import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { env } from "./env";
import { ApiError } from "./http";

export type UserContext = {
  supabase: SupabaseClient;
  user: User;
};

// Every API route acts as the signed-in student, so row-level security applies to every query.
export async function requireUser(request: Request): Promise<UserContext> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    throw new ApiError(401, "Please sign in first.", "unauthorized");
  }
  const token = match[1].trim();

  const supabase = createClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new ApiError(401, "Your session ended. Please open the app again.", "unauthorized");
  }
  return { supabase, user: data.user };
}

// Throws a logged, student-safe error when a Supabase call fails.
export function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) {
    console.error(`Supabase ${what} failed:`, result.error.message);
    throw new ApiError(500, "Saving didn't work. Try again.", "db_error");
  }
  return result.data;
}
