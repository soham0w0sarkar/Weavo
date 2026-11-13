import type { webSocketTransport } from "@weavo/transport";

type Handler = () => void;
type MessageHandler = (data: Uint8Array) => void;

type MemoryClient = {
  deliver: (data: Uint8Array) => void;
};

export type MemoryTransport = webSocketTransport & {
  /** Drop the connection like a network failure. Sends are lost, not queued. */
  goOffline: () => void;
  /** Restore a dropped connection and fire open again. */
  goOnline: () => void;
  isOnline: () => boolean;
  /** Keep the socket open but drop incoming frames, like a stalled link. */
  setDeaf: (deaf: boolean) => void;
  /** Frames this client tried to send while offline. */
  offlineSends: Uint8Array[];
};

export class MemoryRoom {
  private clients = new Set<MemoryClient>();

  join(): MemoryTransport {
    const messageHandlers = new Set<MessageHandler>();
    const openHandlers = new Set<Handler>();
    const closeHandlers = new Set<Handler>();
    const room = this;
    const offlineSends: Uint8Array[] = [];
    let deaf = false;

    const client: MemoryClient = {
      deliver(data: Uint8Array) {
        if (deaf) return;
        for (const cb of messageHandlers) cb(data);
      },
    };

    const open = () => {
      room.clients.add(client);
      queueMicrotask(() => {
        if (!room.clients.has(client)) return;
        for (const cb of openHandlers) cb();
      });
    };

    const close = () => {
      if (!room.clients.delete(client)) return;
      for (const cb of closeHandlers) cb();
    };

    return {
      connect: open,
      disconnect: close,
      goOffline: close,
      goOnline: open,
      isOnline: () => room.clients.has(client),
      setDeaf: (next) => {
        deaf = next;
      },
      offlineSends,

      send(data: Uint8Array) {
        if (!room.clients.has(client)) {
          offlineSends.push(data);
          return;
        }
        for (const peer of room.clients) {
          if (peer !== client) peer.deliver(data);
        }
      },

      onMessage(cb: MessageHandler) {
        messageHandlers.add(cb);
        return () => messageHandlers.delete(cb);
      },

      onOpen(cb: Handler) {
        openHandlers.add(cb);
        return () => openHandlers.delete(cb);
      },

      onClose(cb: Handler) {
        closeHandlers.add(cb);
        return () => closeHandlers.delete(cb);
      },
    };
  }
}
