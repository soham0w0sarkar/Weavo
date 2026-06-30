const DEFAULT_WS_BASE = "ws://localhost:8080";

/** WebSocket origin/path without a room query param. */
export function getRelayWsBase(): string {
  const configured = process.env.NEXT_PUBLIC_RELAY_WS_URL?.trim();
  if (!configured) return DEFAULT_WS_BASE;

  const url = new URL(configured);
  url.searchParams.delete("room");
  const query = url.searchParams.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}

export function buildRelayRoomUrl(roomId: string): string {
  const base = getRelayWsBase();
  const url = new URL(base);
  url.searchParams.set("room", roomId);
  return url.toString();
}
