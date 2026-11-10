import type { NotebookColor, NotebookView } from "@/lib/api-types";
import { NOTEBOOK_COLORS } from "@/lib/api-types";
import { ApiError } from "./http";
import { invalidateLessons } from "./path";
import { check, type UserContext } from "./supabase";

export const DEFAULT_NOTEBOOK = "My notes";
const MAX_NAME = 80;

// Trims and collapses spaces; refuses names that are empty or too long.
export function cleanNotebookName(name: unknown): string {
  const clean = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
  if (!clean) throw new ApiError(400, "Give the notebook a name.", "bad_name");
  if (clean.length > MAX_NAME) throw new ApiError(400, "That notebook name is too long.", "bad_name");
  return clean;
}

export function cleanNotebookColor(color: unknown): NotebookColor | undefined {
  if (color === undefined || color === null || color === "") return undefined;
  if (typeof color === "string" && (NOTEBOOK_COLORS as readonly string[]).includes(color)) return color as NotebookColor;
  throw new ApiError(400, "Pick one of the notebook colors.", "bad_color");
}

// A new notebook takes the first color not already in use, so notebooks stay easy to tell apart.
export function nextColor(used: readonly string[]): NotebookColor {
  return NOTEBOOK_COLORS.find((c) => !used.includes(c)) ?? NOTEBOOK_COLORS[used.length % NOTEBOOK_COLORS.length];
}

type NotebookRow = { id: string; name: string; color: NotebookColor; created_at: string; note_sources: { count: number }[] };

export async function listNotebooks(ctx: UserContext): Promise<NotebookView[]> {
  const rows = check(
    await ctx.supabase.from("notebooks").select("id, name, color, created_at, note_sources(count)").order("created_at"),
    "list notebooks",
  ) as NotebookRow[];
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, sources: r.note_sources[0]?.count ?? 0, createdAt: r.created_at }));
}

function isUniqueViolation(error: { code?: string } | null) {
  return error?.code === "23505";
}

export async function createNotebook(ctx: UserContext, input: { name: unknown; color?: unknown }): Promise<NotebookView> {
  const name = cleanNotebookName(input.name);
  const existing = await listNotebooks(ctx);
  if (existing.some((n) => n.name.toLowerCase() === name.toLowerCase())) {
    throw new ApiError(409, `You already have a notebook called "${name}".`, "duplicate_name");
  }
  const color = cleanNotebookColor(input.color) ?? nextColor(existing.map((n) => n.color));
  const result = await ctx.supabase.from("notebooks").insert({ user_id: ctx.user.id, name, color }).select("id, name, color, created_at").single();
  if (isUniqueViolation(result.error)) throw new ApiError(409, `You already have a notebook called "${name}".`, "duplicate_name");
  const row = check(result, "create notebook") as Omit<NotebookRow, "note_sources">;
  return { id: row.id, name: row.name, color: row.color, sources: 0, createdAt: row.created_at };
}

export async function updateNotebook(ctx: UserContext, id: string, input: { name?: unknown; color?: unknown }): Promise<NotebookView> {
  const patch: Record<string, string> = {};
  if (input.name !== undefined) patch.name = cleanNotebookName(input.name);
  const color = cleanNotebookColor(input.color);
  if (color) patch.color = color;
  if (Object.keys(patch).length === 0) throw new ApiError(400, "Nothing to change.", "empty");

  const result = await ctx.supabase.from("notebooks").update(patch).eq("id", id).select("id").maybeSingle();
  if (isUniqueViolation(result.error)) throw new ApiError(409, `You already have a notebook called "${patch.name}".`, "duplicate_name");
  if (!check(result, "update notebook")) throw new ApiError(404, "That notebook isn't here anymore.", "not_found");
  const updated = (await listNotebooks(ctx)).find((n) => n.id === id);
  if (!updated) throw new ApiError(404, "That notebook isn't here anymore.", "not_found");
  return updated;
}

// Deleting a notebook deletes the notes in it, and the lessons that quoted them rebuild.
export async function deleteNotebook(ctx: UserContext, id: string): Promise<{ deleted: true; notesRemoved: number; lessonsRefreshed: number }> {
  const found = check(await ctx.supabase.from("notebooks").select("id").eq("id", id).maybeSingle(), "find notebook");
  if (!found) throw new ApiError(404, "That notebook isn't here anymore.", "not_found");

  const sources = check(await ctx.supabase.from("note_sources").select("id").eq("notebook_id", id), "find notebook notes") as { id: string }[];
  const sourceIds = sources.map((s) => s.id);
  let stones: string[] = [];
  if (sourceIds.length) {
    const rows = check(
      await ctx.supabase.from("note_chunks").select("stone_id").in("source_id", sourceIds).not("stone_id", "is", null),
      "find notebook stones",
    ) as { stone_id: string }[];
    stones = [...new Set(rows.map((r) => r.stone_id))];
    check(await ctx.supabase.from("note_sources").delete().in("id", sourceIds), "remove notebook notes");
  }
  check(await ctx.supabase.from("notebooks").delete().eq("id", id), "delete notebook");
  await invalidateLessons(ctx, stones);
  return { deleted: true, notesRemoved: sourceIds.length, lessonsRefreshed: stones.length };
}

// The notebook new notes go into: the one picked by id, else one found (or made) by name, else "My notes".
export async function resolveNotebook(ctx: UserContext, input: { notebookId?: string | null; notebookName?: string | null }): Promise<string> {
  if (input.notebookId) {
    const row = check(await ctx.supabase.from("notebooks").select("id").eq("id", input.notebookId).maybeSingle(), "find notebook");
    if (!row) throw new ApiError(404, "That notebook isn't here anymore. Pick another one.", "not_found");
    return input.notebookId;
  }
  const name = input.notebookName?.trim() ? cleanNotebookName(input.notebookName) : DEFAULT_NOTEBOOK;
  const existing = await listNotebooks(ctx);
  const match = existing.find((n) => n.name.toLowerCase() === name.toLowerCase());
  if (match) return match.id;
  try {
    return (await createNotebook(ctx, { name })).id;
  } catch (error) {
    // Two uploads racing to make the same notebook: use the one that won.
    if (error instanceof ApiError && error.code === "duplicate_name") {
      const again = (await listNotebooks(ctx)).find((n) => n.name.toLowerCase() === name.toLowerCase());
      if (again) return again.id;
    }
    throw error;
  }
}
