import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

// An error whose message is safe and friendly enough to show the student.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = "error",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function json<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}

export function toErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return json({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof ZodError) {
    return json({ error: { code: "bad_request", message: "Some of that input didn't look right.", issues: error.issues } }, 400);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return json({ error: { code: "busy", message: "The study helper is busy. Try again in a minute." } }, 429);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    console.error("Anthropic credentials rejected", error.message);
    return json({ error: { code: "server_config", message: "The app's AI key isn't set up correctly." } }, 500);
  }
  if (error instanceof Anthropic.BadRequestError) {
    console.error("Anthropic rejected the request", error.message);
    return json({ error: { code: "ai_bad_request", message: "That file couldn't be read. Try a clearer photo or a smaller file." } }, 422);
  }
  if (error instanceof Anthropic.APIError) {
    console.error(`Anthropic API error ${error.status}`, error.message);
    return json({ error: { code: "ai_unavailable", message: "The study helper is having trouble. Try again soon." } }, 502);
  }
  console.error(error);
  return json({ error: { code: "internal", message: "Something went wrong. Try again." } }, 500);
}

// Wraps a route handler so every thrown error becomes a consistent JSON response.
export function route<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

// Runs fn over items with at most `limit` in flight, preserving order.
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
