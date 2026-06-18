import {
  apply,
  createDeleteOperation,
  createInsertOperation,
  toKey,
  type ClientId,
  type DeleteOperation,
  type Document,
  type InsertOperation,
  type NodeStore,
  type OperationId,
} from "@repo/core";
import {
  addToBuffer,
  canApply,
  flush,
  missingOps,
  update,
  type StateVector,
} from "@repo/sync";
import type { Message, Transport } from "@repo/transport";
import type { PeersReq, TimerRef } from "./types";

const nodesToOp = (
  nd: NodeStore,
  ops: OperationId[],
): (InsertOperation | DeleteOperation)[] => {
  const operations: (InsertOperation | DeleteOperation)[] = [];

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

const isOpPresent = (
  store: NodeStore,
  op: InsertOperation | DeleteOperation,
): boolean => {
  const node = store.nodes.get(toKey(op.type === "insert" ? op.id : op.target));
  if (!node) return false;
  if (op.type === "delete") return node.tombstone;
  return true;
};

const handleIncomingOp = (
  doc: Document,
  op: InsertOperation | DeleteOperation,
  sv: StateVector,
) => {
  if (isOpPresent(doc.store, op)) return;

  if (canApply(doc, op)) {
    apply(doc, op);
    flush(doc, op);
    update(sv, op.type === "delete" ? op.target : op.id);
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
  ops: (InsertOperation | DeleteOperation)[],
  sv: StateVector,
  timerRef: TimerRef,
) => {
  const isMinePresent = clientIds.includes(opClientId);

  if (isMinePresent) {
    ops.map((op) => {
      handleIncomingOp(doc, op, sv);
    });
    return;
  }

  clearTimeout(timerRef.current);
};

export const manageTransport = (
  transport: Transport,
  doc: Document,
  sv: StateVector,
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
        handleIncomingOp(doc, message.op, sv);
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
          requestQueue,
          doc.clientId,
          message.ops,
          sv,
          timerRef,
        );
    }
  });
};
