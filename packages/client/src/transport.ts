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
import type { MembershipHandle } from "@weavo/membership";
import {
  addToBuffer,
  canApply,
  flush,
  flushMembership,
  missingOps,
  update,
  type OperationBuffer,
  type StateVector,
} from "@weavo/sync";
import {
  isMembershipMessage,
  type Message,
  type Transport,
} from "@weavo/transport";
import type { OnApplied, TimerRef } from "./types";

export const nodesToOp = (nd: NodeStore, ops: OperationId[]): Operation[] => {
  const operations: Operation[] = [];

  for (const op of ops) {
    const node = nd.nodes.get(toKey(op));

    if (!node) throw new Error(`${op} isn't present`);

    const insertOp = createInsertOperation(
      op,
      node.value,
      node.leftOrigin!,
      node.rightOrigin,
    );

    if (node.tombstone) operations.push(insertOp, createDeleteOperation(op));
    else operations.push(insertOp);
  }

  return operations;
};

const isOpPresent = (store: NodeStore, op: Operation): boolean => {
  const node = store.nodes.get(toKey(op.type === "insert" ? op.id : op.target));
  if (!node) return false;
  if (op.type === "delete") return node.tombstone;
  return true;
};

const opKey = (op: Operation) =>
  op.type === "insert" ? `i:${toKey(op.id)}` : `d:${toKey(op.target)}`;

/** True when `theirs` holds an insert clock that `mine` has not reached. */
const isAhead = (theirs: StateVector, mine: StateVector) => {
  for (const [clientId, clock] of theirs) {
    if (clock > (mine.get(clientId) ?? -1)) return true;
  }
  return false;
};

const SYNC_REQUEST_DEBOUNCE_MS = 50;

type PendingRequest = {
  vector: StateVector;
  covered: Set<string>;
};

/**
 * Answers sync-requests with suppression: one timer per peer, delay shrinks
 * with how much the peer has to offer, and a response from someone else
 * cancels only what it already covered.
 */
const createResponder = (
  doc: Document,
  sv: StateVector,
  transport: Transport,
) => {
  const pending = new Map<ClientId, PendingRequest>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const opsFor = (vector: StateVector) =>
    nodesToOp(doc.store, missingOps(sv, vector));

  const remainingFor = (request: PendingRequest) =>
    opsFor(request.vector).filter((op) => !request.covered.has(opKey(op)));

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const send = () => {
    timer = undefined;
    const ops = new Map<string, Operation>();
    const clientIds: ClientId[] = [];

    for (const [clientId, request] of pending) {
      const remaining = remainingFor(request);
      if (remaining.length === 0) continue;
      clientIds.push(clientId);
      for (const op of remaining) ops.set(opKey(op), op);
    }
    pending.clear();

    if (clientIds.length === 0) return;
    transport.send({
      type: "sync-response",
      ops: [...ops.values()],
      clientIds,
    });
  };

  return {
    onRequest(requester: ClientId, vector: StateVector) {
      const count = opsFor(vector).length;
      if (count === 0) {
        pending.delete(requester);
        if (pending.size === 0) clearTimer();
        return;
      }

      pending.set(requester, { vector, covered: new Set() });
      if (timer !== undefined) return;
      const uniform = Math.max(Math.random(), Number.EPSILON);
      timer = setTimeout(send, -Math.log(uniform) / count);
    },

    onResponse(clientIds: ClientId[], ops: Operation[]) {
      if (pending.size === 0) return;
      const keys = ops.map(opKey);

      for (const clientId of clientIds) {
        const request = pending.get(clientId);
        if (!request) continue;
        for (const key of keys) request.covered.add(key);
        if (remainingFor(request).length === 0) pending.delete(clientId);
      }

      if (pending.size === 0) clearTimer();
    },

    reset() {
      pending.clear();
      clearTimer();
    },
  };
};

export const manageTransport = (
  transport: Transport,
  doc: Document,
  sv: StateVector,
  buffer: OperationBuffer,
  onApplied: OnApplied,
  membership: MembershipHandle,
) => {
  const responder = createResponder(doc, sv, transport);
  const requestTimer: TimerRef = { current: undefined };
  let open = false;

  const clearRequestTimer = () => {
    if (requestTimer.current === undefined) return;
    clearTimeout(requestTimer.current);
    requestTimer.current = undefined;
  };

  const requestSync = () => {
    clearRequestTimer();
    if (!open || !membership.isJoined()) return;
    transport.send({
      type: "sync-request",
      vector: sv,
      clientId: doc.clientId,
    });
  };

  const scheduleSyncRequest = () => {
    clearRequestTimer();
    requestTimer.current = setTimeout(requestSync, SYNC_REQUEST_DEBOUNCE_MS);
  };

  const applyIncoming = (op: Operation) => {
    if (isOpPresent(doc.store, op)) return;

    if (!canApply(doc, op)) {
      addToBuffer(buffer, doc, op);
      scheduleSyncRequest();
      return;
    }

    const index = apply(doc, op);
    if (op.type === "insert") update(sv, op.id);
    onApplied(op, index);

    for (const applied of flush(buffer, doc, op)) {
      if (applied.op.type === "insert") update(sv, applied.op.id);
      onApplied(applied.op, applied.index);
    }
  };

  transport.onOpen(() => {
    open = true;
    if (!membership.isJoined()) membership.requestJoin(doc.clientId);
    requestSync();
  });

  transport.onClose(() => {
    open = false;
    clearRequestTimer();
    responder.reset();
  });

  membership.onJoined(() => {
    requestSync();
  });

  transport.onMessage((message: Message) => {
    if (isMembershipMessage(message)) {
      membership.onMessage(message);

      for (const { op, index } of flushMembership(buffer, doc, membership)) {
        if (op.type === "insert") update(sv, op.id);
        onApplied(op, index);
      }
      return;
    }

    if (!membership.isJoined()) return;

    switch (message.type) {
      case "op":
        applyIncoming(message.op);
        break;
      case "sync-request":
        if (message.clientId === doc.clientId) break;
        responder.onRequest(message.clientId, message.vector);
        if (isAhead(message.vector, sv)) scheduleSyncRequest();
        break;
      case "sync-response":
        responder.onResponse(message.clientIds, message.ops);
        if (message.clientIds.includes(doc.clientId)) {
          for (const op of message.ops) applyIncoming(op);
        }
        break;
    }
  });

  return {
    /** Ask peers for anything missed. No-op until the socket is open and joined. */
    requestSync,
    isOpen: () => open,
  };
};
