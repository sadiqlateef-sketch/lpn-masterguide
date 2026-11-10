import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "./env";
import { ApiError } from "./http";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

export const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

export type ImageInput = { mediaType: ImageMediaType; base64: string };

// On a policy decline, the API retries on Anthropic's recommended fallback model inside the same call.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: env.anthropicApiKey(), maxRetries: 3 });
  return client;
}

export function imageBlocks(images: readonly ImageInput[]): ContentBlock[] {
  return images.map((image) => ({
    type: "image",
    source: { type: "base64", media_type: image.mediaType, data: image.base64 },
  }));
}

export function pdfBlock(base64: string): ContentBlock {
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
}

// System prompts are fixed per task, so caching them makes repeat calls cheaper and faster.
function cachedSystem(text: string): Anthropic.Beta.BetaTextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

function assertUsable(message: Anthropic.Beta.BetaMessage, what: string) {
  if (message.stop_reason === "refusal") {
    console.warn(`${what}: model declined`, message.stop_details);
    throw new ApiError(422, "That couldn't be processed. Try a different photo or text.", "declined");
  }
  if (message.stop_reason === "max_tokens") {
    console.error(`${what}: hit max_tokens`);
    throw new ApiError(502, "That was too big to finish in one go. Try a smaller piece.", "too_long");
  }
}

type StructuredRequest<Schema extends z.ZodType> = {
  what: string;
  schema: Schema;
  system: string;
  content: ContentBlock[] | string;
  effort?: Effort;
  maxTokens?: number;
};

// One Claude call whose reply is validated against `schema`. Streams so large outputs never time out.
export async function generateStructured<Schema extends z.ZodType>(req: StructuredRequest<Schema>): Promise<z.infer<Schema>> {
  const stream = anthropic().beta.messages.stream({
    model: env.anthropicModel(),
    max_tokens: req.maxTokens ?? 32000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: cachedSystem(req.system),
    output_config: { effort: req.effort ?? "medium", format: betaZodOutputFormat(req.schema) },
    messages: [{ role: "user", content: req.content }],
  });
  const message = await stream.finalMessage();
  assertUsable(message, req.what);
  if (message.parsed_output == null) {
    console.error(`${req.what}: reply did not match the schema`);
    throw new ApiError(502, "The study helper gave a confusing answer. Try again.", "bad_ai_output");
  }
  return message.parsed_output as z.infer<Schema>;
}

type WebResearchRequest = {
  what: string;
  system: string;
  prompt: string;
  maxSearches?: number;
  effort?: Effort;
};

// A Claude call with web search. Returns the final text answer.
export async function researchWithWebSearch(req: WebResearchRequest): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: req.prompt }];
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: req.maxSearches ?? 6 },
  ];

  // Server tools can pause a long turn; resume it by sending the partial reply back.
  for (let attempt = 0; attempt < 4; attempt++) {
    const message = await anthropic()
      .beta.messages.stream({
        model: env.anthropicModel(),
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system: cachedSystem(req.system),
        output_config: { effort: req.effort ?? "medium" },
        tools,
        messages,
      })
      .finalMessage();

    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    assertUsable(message, req.what);
    return message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  }
  throw new ApiError(502, "Looking that up took too long. Try again.", "timeout");
}
