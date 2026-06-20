import {
  createReplica,
  findIndex,
  generateClientId,
  onInput as localInput,
  onBeforeInput as localBeforeInput,
  type Operation,
} from "@repo/core";
import { createTransport, createWebSocketTransport } from "@repo/transport";
import { manageTransport } from "./transport";
import type { StateVector } from "@repo/sync";
import { createSubscription } from "./Subscription";

export const createRelay = (url: string) => {
  const clientId = generateClientId();

  const doc = createReplica(clientId);
  const sv: StateVector = new Map();
  const rawTransport = createWebSocketTransport(url);
  const transport = createTransport(rawTransport);
  const subscription = createSubscription();

  const onApplied = (op: Operation) => {
    if (op.type === "insert") {
      const index = findIndex(doc.skipList, op.leftOrigin);
      subscription.emit({ index, insert: op.value });
    }
    if (op.type === "delete") {
      const index = findIndex(doc.skipList, op.target);
      subscription.emit({ index, delete: 1 });
    }
  };

  const before = null;

  const onBeforeInput = (event: InputEvent) => {
    localBeforeInput(event, before);
  };

  const onInput = (event: InputEvent) => {
    const ops = localInput(event, doc, before);
    if (!ops) return;
    ops.map((op) => {
      (onApplied(op), transport.send({ type: "op", op }));
    });
  };

  manageTransport(transport, doc, sv, onApplied);

  return {
    textSubscribe: subscription.subscribe,
    onInput,
    onBeforeInput,
  };
};
