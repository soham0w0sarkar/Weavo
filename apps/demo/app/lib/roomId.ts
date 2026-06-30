/** Extract a room id from a pasted UUID or full share URL. */
export function parseRoomId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const asUrl = new URL(trimmed);
    const fromQuery = asUrl.searchParams.get("room");
    if (fromQuery) return fromQuery;
  } catch {
    // not a URL — fall through
  }

  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuid.test(trimmed)) return trimmed;

  return null;
}

export function createRoomId(): string {
  return crypto.randomUUID();
}
