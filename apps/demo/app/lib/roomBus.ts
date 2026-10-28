/**
 * Demo side-channel on the Weavo room relay.
 *
 * The relay is dumb and forwards opaque frames to everyone in a room. Weavo's
 * CRDT client speaks a binary protocol, so the bus uses a *sibling* room
 * (`${room}::weavo-bus`) instead of sharing the document room — otherwise JSON
 * diagnostics frames land on the CRDT socket and blow up the transport.
 */

/** Parallel room id so bus JSON never mixes with CRDT binary frames. */
export const busRoomUrl = (weavoUrl: string): string => {
  const url = new URL(weavoUrl);
  const room = url.searchParams.get("room") ?? "default";
  url.searchParams.set("room", `${room}::weavo-bus`);
  return url.toString();
};

export type RoomBusMessage =
  | {
      v: 1;
      kind: "diagnostics";
      clientId: string;
      name: string;
      color: string;
      language: string;
      markers: SharedMarker[];
    };

export type SharedMarker = {
  severity: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  code?: string;
};

const isRoomBusMessage = (value: unknown): value is RoomBusMessage => {
  if (!value || typeof value !== "object") return false;
  const msg = value as RoomBusMessage;
  return msg.v === 1 && msg.kind === "diagnostics" && typeof msg.clientId === "string";
};

export type RoomBus = {
  send: (message: RoomBusMessage) => void;
  close: () => void;
};

export const openRoomBus = (
  weavoUrl: string,
  onMessage: (message: RoomBusMessage) => void,
): RoomBus => {
  let socket: WebSocket | null = null;
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;

  const connect = () => {
    if (closed) return;
    const ws = new WebSocket(busRoomUrl(weavoUrl));
    socket = ws;

    ws.addEventListener("open", () => {
      attempt = 0;
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (isRoomBusMessage(parsed)) onMessage(parsed);
      } catch {
        // Binary Weavo frames from mistaken peers — ignore.
      }
    });

    ws.addEventListener("close", () => {
      if (closed) return;
      const delay = Math.min(8_000, 400 * 2 ** attempt);
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    });
  };

  connect();

  return {
    send(message) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
      socket = null;
    },
  };
};
