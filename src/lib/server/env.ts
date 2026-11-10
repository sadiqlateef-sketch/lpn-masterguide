import { ApiError } from "./http";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable ${name}`);
    throw new ApiError(500, "The app isn't fully set up yet. Ask the owner to add the missing keys.", "server_config");
  }
  return value;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  anthropicApiKey: () => required("ANTHROPIC_API_KEY"),
  anthropicModel: () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  // For the few hard cases the everyday model isn't sure about, such as an Anki card with a doubtful fact-check.
  // The owner sets it in Vercel; until then the hard cases get a second, more careful look from the everyday model.
  anthropicReviewModel: () => process.env.ANTHROPIC_REVIEW_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  voyageApiKey: () => required("VOYAGE_API_KEY"),
  voyageModel: () => process.env.VOYAGE_MODEL || "voyage-3.5",
  googleBooksApiKey: () => process.env.GOOGLE_BOOKS_API_KEY || null,
};
