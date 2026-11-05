import type { ServerWebSocket } from "bun";

type RoomData = { room: string };

const PORT = Number(process.env.PORT ?? 8080);
const GITHUB_PAGES_ORIGIN = "https://soham0w0sarkar.github.io";
const startedAt = Date.now();
const rooms = new Map<string, Set<ServerWebSocket<RoomData>>>();

const allowedOrigins = new Set(
  (process.env.WEAVO_ALLOWED_ORIGINS ?? GITHUB_PAGES_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

/** Local `bun run dev` sets this. Production stays on the explicit allowlist. */
const allowLan = process.env.WEAVO_ALLOW_LAN === "1";

const getRoom = (room: string) => {
  if (!rooms.has(room)) rooms.set(room, new Set());
  return rooms.get(room)!;
};

const isPrivateHost = (hostname: string) => {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (hostname.startsWith("192.168.")) return true;
  if (hostname.startsWith("10.")) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
};

const originAllowed = (origin: string | null) => {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  if (!allowLan) return false;

  try {
    const url = new URL(origin);
    return url.protocol === "http:" && isPrivateHost(url.hostname);
  } catch {
    return false;
  }
};

const corsHeaders = (origin: string | null): Record<string, string> => {
  if (!originAllowed(origin)) return {};
  return {
    "access-control-allow-origin": origin!,
    vary: "Origin",
  };
};

const httpResponse = (body: string, status = 200, origin: string | null = null) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...corsHeaders(origin),
    },
  });

const jsonResponse = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });

const websocketUrl = (req: Request) => {
  const host = req.headers.get("host") ?? `localhost:${PORT}`;
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const wsProto = proto === "https" ? "wss" : "ws";
  return `${wsProto}://${host}`;
};

Bun.serve<RoomData>({
  port: PORT,
  hostname: "0.0.0.0",
  fetch(req, server) {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");

    if (req.method === "OPTIONS") {
      if (!originAllowed(origin)) return httpResponse("Forbidden\n", 403, origin);
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin),
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "Content-Type",
        },
      });
    }

    if (url.pathname === "/health") {
      return httpResponse("ok\n", 200, origin);
    }

    if (url.pathname === "/ready") {
      return jsonResponse(
        {
          ready: true,
          service: "weavo-server",
          websocket: websocketUrl(req),
          uptime: process.uptime(),
          startedAt: new Date(startedAt).toISOString(),
        },
        200,
        origin,
      );
    }

    const upgrade = (req.headers.get("upgrade") ?? "").toLowerCase() === "websocket";
    if (upgrade && !originAllowed(origin)) {
      console.warn(`rejected websocket origin: ${origin ?? "(missing)"}`);
      return httpResponse("Forbidden\n", 403, origin);
    }

    const room = url.searchParams.get("room") ?? "default";

    if (server.upgrade(req, { data: { room } })) return undefined;

    return httpResponse(
      `Weavo WebSocket server\nConnect with ?room=<id>\nHealth: /health\nReady: /ready\n`,
      200,
      origin,
    );
  },
  websocket: {
    open(ws) {
      const peers = getRoom(ws.data.room);
      peers.add(ws);
      console.log(
        `client joined room "${ws.data.room}" (${peers.size} connected)`,
      );
    },
    message(ws, message) {
      const peers = getRoom(ws.data.room);

      for (const peer of peers) {
        if (peer !== ws && peer.readyState === WebSocket.OPEN) {
          peer.send(message);
        }
      }
    },
    close(ws) {
      const peers = rooms.get(ws.data.room);
      if (!peers) return;
      peers.delete(ws);
      if (peers.size === 0) rooms.delete(ws.data.room);
      console.log(
        `client left room "${ws.data.room}" (${peers.size} connected)`,
      );
    },
  },
});

console.log(`Weavo WebSocket server listening on ws://0.0.0.0:${PORT}`);
console.log(`Allowed origins: ${[...allowedOrigins].join(", ")}`);
console.log(`Local:   ws://localhost:${PORT}`);
console.log(`Network: open the demo Network URL on your phone (same Wi‑Fi)`);
