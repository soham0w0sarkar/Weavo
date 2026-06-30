import {
  type OperationKey,
  type Document,
  toKey,
  type InsertOperation,
  type DeleteOperation,
  type Operation,
  type AppliedOp,
  apply,
  type OperationId,
} from "@relay/code";

const waiting = new Map<OperationKey, Set<InsertOperation>>();
const buffered = new Map<OperationKey, InsertOperation>();
const pendingDeleteOps = new Map<OperationKey, DeleteOperation>();

const getMissingDeps = (
  doc: Document,
  op: Operation,
): OperationKey[] => {
  const missing = [];

  if (op.type === "insert") {
    if (!doc.store.nodes.has(toKey(op.leftOrigin)))
      missing.push(toKey(op.leftOrigin));
    if (op.rightOrigin && !doc.store.nodes.has(toKey(op.rightOrigin)))
      missing.push(toKey(op.rightOrigin));
  }

  return missing;
};

export const addToBuffer = (
  doc: Document,
  op: Operation,
) => {
  if (op.type === "delete") {
    pendingDeleteOps.set(toKey(op.target), op);
    return;
  }

  buffered.set(toKey(op.id), op);

  const missing = getMissingDeps(doc, op);
  for (const dep of missing) {
    if (!waiting.has(dep)) waiting.set(dep, new Set());
    waiting.get(dep)!.add(op);
  }
};

export const flush = (
  doc: Document,
  unblockedKey: Operation,
): AppliedOp[] => {
  if (unblockedKey.type === "delete") {
    pendingDeleteOps.delete(toKey(unblockedKey.target));
    return [];
  }

  const operations: AppliedOp[] = [];
  const waitingQueue = [...(waiting.get(toKey(unblockedKey.id)) ?? [])];

  while (waitingQueue.length) {
    const op = waitingQueue.shift()!;
    if (!canApply(doc, op)) continue;

    const index = apply(doc, op);
    cleanUp(op);
    operations.push({ op, index });

    const next = waiting.get(toKey(op.id)) ?? [];
    waitingQueue.push(...next);
  }

  return operations;
};

const cleanUp = (op: InsertOperation) => {
  buffered.delete(toKey(op.id));

  const deps = [toKey(op.leftOrigin)];
  if (op.rightOrigin) deps.push(toKey(op.rightOrigin));

  for (let dep of deps) {
    const set = waiting.get(dep);
    if (!set) continue;

    set.delete(op);
    if (set.size === 0) waiting.delete(dep);
  }
};

export const canApply = (
  doc: Document,
  op: Operation,
): boolean => {
  if (op.type === "insert") return canApplyInsert(doc, op);

  return canApplyDelete(doc, op);
};

const canApplyDelete = (doc: Document, op: DeleteOperation): boolean => {
  return doc.store.nodes.has(toKey(op.target));
};

const canApplyInsert = (doc: Document, op: InsertOperation): boolean => {
  const leftExists = doc.store.nodes.has(toKey(op.leftOrigin));

  const rightExists =
    op.rightOrigin === null ? true : doc.store.nodes.has(toKey(op.rightOrigin));

  return leftExists && rightExists;
};
