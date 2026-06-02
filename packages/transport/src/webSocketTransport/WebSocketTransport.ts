import type { webSocketTransport, Unsubscribe } from "./types";

export const createWebSocketTransport = (url: string): webSocketTransport => {
  let socket: WebSocket | null = null;

  const messageListeners = new Set<(data: string) => void>();

  const openListeners = new Set<() => void>();

  const closeListeners = new Set<() => void>();

  const subscribe = <T>(listeners: Set<T>, cb: T): Unsubscribe => {
    listeners.add(cb);

    return () => {
      listeners.delete(cb);
    };
  };

  return {
    connect() {
      if (socket) return;

      socket = new WebSocket(url);

      socket.addEventListener("open", () => {
        openListeners.forEach((cb) => cb());
      });

      socket.addEventListener("message", (event) => {
        messageListeners.forEach((cb) => cb(event.data));
      });

      socket.addEventListener("close", () => {
        closeListeners.forEach((cb) => cb());
        socket = null;
      });
    },

    disconnect() {
      socket?.close();
    },

    send(data: string) {
      if (!socket) {
        throw new Error("Transport not connected");
      }

      socket.send(data);
    },

    onMessage(cb) {
      return subscribe(messageListeners, cb);
    },

    onOpen(cb) {
      return subscribe(openListeners, cb);
    },

    onClose(cb) {
      return subscribe(closeListeners, cb);
    },
  };
};
