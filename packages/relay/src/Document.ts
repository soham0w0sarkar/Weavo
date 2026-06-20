import {
  createReplica,
  findIndex,
  generateClientId,
  onInput as localInput,
  type Operation,
} from "@repo/core";
import { createTransport, createWebSocketTransport } from "@repo/transport";
import { manageTransport } from "./transport";
import { update, type StateVector } from "@repo/sync";
import { createSubscription } from "./Subscription";

export const createRelay = (url: string) => {
  const clientId = generateClientId();

  const doc = createReplica(clientId);
  const sv: StateVector = new Map();
  const rawTransport = createWebSocketTransport(url);
  const transport = createTransport(rawTransport);
  const subscription = createSubscription();

  let before: { start: number; end: number; value: string } | null = null;

  const onApplied = (op: Operation) => {
    if (op.type === "insert") {
      const index = findIndex(doc.skipList, op.id);
      subscription.emit({ index, insert: op.value });
    }
    if (op.type === "delete") {
      const index = findIndex(doc.skipList, op.target);
      subscription.emit({ index, delete: 1 });
    }
  };

  const onBeforeInput = (event: InputEvent) => {
    const target = event.target as HTMLTextAreaElement;
    before = {
      start: target.selectionStart,
      end: target.selectionEnd,
      value: target.value,
    };
  };

  const onInput = (event: InputEvent) => {
    const ops = localInput(event, doc, before);
    if (!ops) return;
    ops.forEach((op) => {
      update(sv, op.type === "insert" ? op.id : op.target);
      onApplied(op);
      transport.send({ type: "op", op });
    });
  };

  manageTransport(transport, doc, sv, onApplied);
  transport.connect();

  return {
    textSubscribe: subscription.subscribe,
    onInput,
    onBeforeInput,
    disconnect: () => transport.disconnect(),
  };
};
