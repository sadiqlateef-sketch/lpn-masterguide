// Adds an option to a pick list, dropping the oldest pick once the limit is reached.
export function togglePick(current: readonly string[], id: string, limit: number): string[] {
  if (current.includes(id)) return current.filter((x) => x !== id);
  const next = [...current, id];
  return next.length > limit ? next.slice(next.length - limit) : next;
}
