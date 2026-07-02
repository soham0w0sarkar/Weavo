import {
  apply,
  createDeleteOperation,
  createInsertOperation,
  toKey,
  type ClientId,
  type Document,
  type NodeStore,
  type Operation,
  type OperationId,
} from "@weavo/core";
import {
  addToBuffer,
  canApply,
  flush,
  missingOps,
  update,
  type StateVector,
} from "@weavo/sync";
import type { Message, Transport } from "@weavo/transport";
import type { OnApplied, PeersReq, TimerRef } from "./types";

const nodesToOp = (nd: NodeStore, ops: OperationId[]): Operation[] => {
  const operations: Operation[] = [];

  ops.map((op) => {
    const node = nd.nodes.get(toKey(op));

    if (!node) throw new Error(`${op} isn't present`);

    const insertOp = createInsertOperation(
      op,
      node.value,
      node.leftOrigin!,
      node.rightOrigin,
    );

    if (node?.tombstone) operations.push(insertOp, createDeleteOperation(op));

    return operations.push(insertOp);
  });

  return operations;
};

const isOpPresent = (store: NodeStore, op: Operation): boolean => {
  const node = store.nodes.get(toKey(op.type === "insert" ? op.id : op.target));
  if (!node) return false;
  if (op.type === "delete") return node.tombstone;
  return true;
};

const handleIncomingOp = (
  doc: Document,
  op: Operation,
  sv: StateVector,
  onApplied: OnApplied,
) => {
  if (isOpPresent(doc.store, op)) return;

  if (canApply(doc, op)) {
    const index = apply(doc, op);
    onApplied(op, index);
    const appliedOps = flush(doc, op);

    appliedOps.forEach(({ op, index }) => onApplied(op, index));

    if(op.type === "insert") {
      update(sv, op.id);
    }
  } else {
    addToBuffer(doc, op);
  }
};

const handleSyncReq = (
  mineSv: StateVector,
  theirSv: StateVector,
  transport: Transport,
  timerRef: TimerRef,
  requestQueue: PeersReq,
  doc: Document,
) => {
  if (timerRef.current) return;

  const misingOps = missingOps(mineSv, theirSv);

  const backOffDelay =
    misingOps.length === 0
      ? Infinity
      : -Math.log(Math.random()) / misingOps.length;

  const ops = nodesToOp(doc.store, misingOps);

  timerRef.current = setTimeout(() => {
    transport.send({ type: "sync-response", ops, clientIds: requestQueue });
    requestQueue.length = 0;
    timerRef.current = undefined;
  }, backOffDelay);
};

const handleSyncRes = (
  doc: Document,
  clientIds: PeersReq,
  opClientId: ClientId,
  ops: Operation[],
  sv: StateVector,
  timerRef: TimerRef,
  onApplied: OnApplied,
) => {
  const isMinePresent = clientIds.includes(opClientId);

  if (isMinePresent) {
    ops.map((op) => {
      handleIncomingOp(doc, op, sv, onApplied);
    });
    return;
  }

  clearTimeout(timerRef.current);
};

export const manageTransport = (
  transport: Transport,
  doc: Document,
  sv: StateVector,
  onApplied: OnApplied,
) => {
  const timerRef: TimerRef = { current: undefined };
  const requestQueue: PeersReq = [];

  transport.onOpen(() => {
    transport.send({
      type: "sync-request",
      vector: sv,
      clientId: doc.clientId,
    });
  });

  transport.onMessage((message: Message) => {
    switch (message.type) {
      case "op":
        handleIncomingOp(doc, message.op, sv, onApplied);
        break;
      case "sync-request":
        requestQueue.push(message.clientId);
        handleSyncReq(
          sv,
          message.vector,
          transport,
          timerRef,
          requestQueue,
          doc,
        );
        break;
      case "sync-response":
        handleSyncRes(
          doc,
          message.clientIds,
          doc.clientId,
          message.ops,
          sv,
          timerRef,
          onApplied,
        );
    }
  });
};
