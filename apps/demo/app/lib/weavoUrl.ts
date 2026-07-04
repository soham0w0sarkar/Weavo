const DEFAULT_WS_BASE = "ws://localhost:8080";

const isLocalHost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1";

/** Upgrade remote URLs to TLS; keeps localhost on ws/http for local dev. */
export function normalizeWeavoServerUrl(input: string | URL): URL {
  const url = typeof input === "string" ? new URL(input) : new URL(input.href);

  if (isLocalHost(url.hostname)) return url;

  if (url.protocol === "http:" || url.protocol === "ws:") {
    url.protocol = url.protocol === "ws:" ? "wss:" : "https:";
  }

  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    (url.protocol === "http:" || url.protocol === "ws:")
  ) {
    url.protocol = url.protocol === "ws:" ? "wss:" : "https:";
  }

  return url;
}

function toWebSocketOrigin(url: URL): URL {
  const normalized = normalizeWeavoServerUrl(url);
  if (normalized.protocol === "http:") normalized.protocol = "ws:";
  if (normalized.protocol === "https:") normalized.protocol = "wss:";
  return normalized;
}

/** WebSocket origin/path without a room query param. */
export function getWeavoWsBase(): string {
  const configured = process.env.NEXT_PUBLIC_WEAVO_WS_URL?.trim();
  if (!configured) return DEFAULT_WS_BASE;

  const url = toWebSocketOrigin(new URL(configured));
  url.searchParams.delete("room");
  const query = url.searchParams.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}

export function buildWeavoRoomUrl(roomId: string): string {
  const base = getWeavoWsBase();
  const url = new URL(base);
  url.searchParams.set("room", roomId);
  return url.toString();
}
