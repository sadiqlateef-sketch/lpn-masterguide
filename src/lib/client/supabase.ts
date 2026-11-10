import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

// The browser's Supabase client. Students are signed in anonymously on first open, so there is no
// login screen; saving an email and password later keeps the same account and its progress.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

export function isConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function browserSupabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Supabase is not configured");
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

let pending: Promise<Session> | null = null;

// Returns the current session, signing in anonymously the first time. Concurrent callers share one sign-in.
export async function ensureSession(): Promise<Session> {
  const supabase = browserSupabase();
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  pending ??= (async () => {
    try {
      const { data: created, error } = await supabase.auth.signInAnonymously();
      if (error || !created.session) {
        throw new Error(error?.message.includes("disabled") ? "Anonymous sign-ins are turned off for this app." : "Couldn't start your session. Check your connection.");
      }
      return created.session;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export type AccountInfo = { email: string | null; pendingEmail: string | null; anonymous: boolean };

export async function accountInfo(): Promise<AccountInfo> {
  const session = await ensureSession();
  const user = session.user;
  return {
    email: user.email || null,
    pendingEmail: user.new_email || null,
    anonymous: Boolean(user.is_anonymous) && !user.email,
  };
}

// Turns the anonymous account into a saved one. Progress stays because the account id doesn't change.
export async function saveAccount(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
  await ensureSession();
  const { data, error } = await browserSupabase().auth.updateUser({ email, password });
  if (error) throw new Error(friendlyAuthError(error.message));
  return { needsConfirmation: !data.user.email || Boolean(data.user.new_email) };
}

// Opens a saved account on this device (for a new phone). Anything made in the current anonymous
// account stays with that anonymous account.
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await browserSupabase().auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyAuthError(error.message));
}

function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login")) return "That email and password don't match.";
  if (lower.includes("already") && lower.includes("registered")) return "That email already has an account. Sign in instead.";
  if (lower.includes("password")) return "Use a password with at least 8 characters.";
  if (lower.includes("email")) return "Check the email address.";
  return "That didn't work. Try again.";
}
