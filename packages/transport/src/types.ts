import type { ClientId, Operation } from "@repo/core";
import type { StateVector } from "@repo/sync";
import type { webSocketTransport } from "./webSocketTransport/types";

export type RawTransport = webSocketTransport;

export type Message =
  | {
      type: "op";
      op: Operation;
    }
  | {
      type: "sync-request";
      vector: StateVector;
      clientId: ClientId;
    }
  | {
      type: "sync-response";
      ops: Operation[];
      clientIds: ClientId[];
    };

export type Transport = {
  connect(): void;
  disconnect(): void;

  send(message: Message): void;

  onMessage(cb: (message: Message) => void): () => void;

  onOpen(cb: () => void): () => void;
  onClose(cb: () => void): () => void;
};
