import type { webSocketTransport } from "@weavo/transport";
import { MemoryRoom } from "./memoryTransport";

export type WireStats = {
  syncRequests: number;
  syncResponses: number;
  ops: number;
};

export type CountingMemoryRoom = {
  join: () => webSocketTransport;
  stats: WireStats;
  resetStats: () => void;
};

export const createCountingRoom = (): CountingMemoryRoom => {
  const room = new MemoryRoom();
  const baseJoin = room.join.bind(room);
  const stats: WireStats = { syncRequests: 0, syncResponses: 0, ops: 0 };

  const countMessage = (data: string) => {
    const msg = JSON.parse(data) as { type: string };
    if (msg.type === "sync-request") stats.syncRequests++;
    else if (msg.type === "sync-response") stats.syncResponses++;
    else if (msg.type === "op") stats.ops++;
  };

  const join = (): webSocketTransport => {
    const raw = baseJoin();
    return {
      connect: raw.connect.bind(raw),
      disconnect: raw.disconnect.bind(raw),
      onMessage: raw.onMessage.bind(raw),
      onOpen: raw.onOpen.bind(raw),
      onClose: raw.onClose.bind(raw),
      send(data: string) {
        countMessage(data);
        raw.send(data);
      },
    };
  };

  return {
    join,
    stats,
    resetStats: () => {
      stats.syncRequests = 0;
      stats.syncResponses = 0;
      stats.ops = 0;
    },
  };
};
