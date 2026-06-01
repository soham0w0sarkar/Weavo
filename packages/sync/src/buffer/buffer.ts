import {
  type OperationKey,
  type Document,
  toKey,
  type InsertOperation,
  type DeleteOperation,
} from "@repo/core";
import type { Operation } from "./types";

export const waiting = new Map<OperationKey, Set<Operation>>();

export const buffered = new Map<OperationKey, Operation>();

const getMissingDeps = (doc: Document, op: Operation): OperationKey[] => {
  const missing = [];

  if (op.type === "insert") {
    if (!doc.store.nodes.has(toKey(op.leftOrigin)))
      missing.push(toKey(op.leftOrigin));
    if (op.rightOrigin && !doc.store.nodes.has(toKey(op.rightOrigin)))
      missing.push(toKey(op.rightOrigin));
  }

  if (op.type === "delete") {
    if (!doc.store.nodes.has(toKey(op.target))) missing.push(toKey(op.target));
  }

  return missing;
};

export const addToBuffer = (doc: Document, op: Operation) => {
  buffered.set(toKey(op.id), op);

  const missing = getMissingDeps(doc, op);
  for (const dep of missing) {
    if (!waiting.has(dep)) waiting.set(dep, new Set());
    waiting.get(dep)!.add(op);
  }
};

export const canApply = (doc: Document, op: Operation): boolean => {
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
