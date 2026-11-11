import {
  apply,
  getText,
  restoreFromStorage,
  toKey,
  type Document,
  type DocumentSnapshot,
  type Operation,
} from "@weavo/core";
import {
  addToBuffer,
  canApply,
  flush,
  missingOps,
  update,
  type OperationBuffer,
  type StateVector,
} from "@weavo/sync";
import type { OnApplied } from "./types";
import { nodesToOp } from "./transport";

const isOpPresent = (store: Document["store"], op: Operation): boolean => {
  const node = store.nodes.get(toKey(op.type === "insert" ? op.id : op.target));
  if (!node) return false;
  if (op.type === "delete") return node.tombstone;
  return true;
};

const applyStoredOp = (
  buffer: OperationBuffer,
  doc: Document,
  op: Operation,
  sv: StateVector,
  onApplied: OnApplied,
) => {
  if (isOpPresent(doc.store, op)) return;

  if (!canApply(doc, op)) {
    addToBuffer(buffer, doc, op);
    return;
  }

  const index = apply(doc, op);
  onApplied(op, index);
  if (op.type === "insert") update(sv, op.id);

  for (const applied of flush(buffer, doc, op)) {
    onApplied(applied.op, applied.index);
    if (applied.op.type === "insert") update(sv, applied.op.id);
  }
};

/** Replay a stored room onto this replica. The replica's own client id stays. */
export const mergeRoomDocument = (
  doc: Document,
  sv: StateVector,
  buffer: OperationBuffer,
  remote: { snapshot: DocumentSnapshot; delta?: Operation[] },
  onApplied: OnApplied,
) => {
  const restored = restoreFromStorage(remote.snapshot, remote.delta ?? []);
  if (
    getText(restored.doc.store).length === 0 &&
    restored.stateVector.size === 0
  ) {
    return;
  }

  const ops = nodesToOp(
    restored.doc.store,
    missingOps(restored.stateVector, sv),
  );
  for (const op of ops) applyStoredOp(buffer, doc, op, sv, onApplied);
};
