import { env } from "./env";
import { ApiError } from "./http";

export const EMBEDDING_DIMENSIONS = 1024;
const BATCH_SIZE = 64;
const MAX_ATTEMPTS = 4;

type VoyageResponse = { data: { embedding: number[]; index: number }[] };

// "document" for things we store (stones, note chunks); "query" for things we search with (questions).
export type EmbeddingInputType = "document" | "query";

async function embedBatch(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.voyageApiKey()}` },
      body: JSON.stringify({
        model: env.voyageModel(),
        input: texts,
        input_type: inputType,
        output_dimension: EMBEDDING_DIMENSIONS,
        truncation: true,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (response.ok) {
      const body = (await response.json()) as VoyageResponse;
      const ordered = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (ordered.length !== texts.length || ordered.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
        throw new ApiError(502, "Matching your notes didn't work. Try again.", "embedding_shape");
      }
      return ordered;
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      console.error(`Voyage embeddings failed (${response.status}):`, await response.text().catch(() => ""));
      throw new ApiError(response.status === 401 ? 500 : 502, "Matching your notes didn't work. Try again.", "embedding_failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
  }
}

export async function embed(texts: readonly string[], inputType: EmbeddingInputType): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map((t) => t.trim() || "(empty)");
    out.push(...(await embedBatch(batch, inputType)));
  }
  return out;
}

export async function embedOne(text: string, inputType: EmbeddingInputType): Promise<number[]> {
  const [vector] = await embed([text], inputType);
  return vector;
}

// pgvector accepts its text form, which survives JSON and PostgREST unchanged.
export function toPgVector(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}
