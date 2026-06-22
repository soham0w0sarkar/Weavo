import type { Operation } from "../operations";
import { insert as crdtInsert, remove as crdtRemove } from "../store";
import {
  findIndex,
  insert as indexingInsert,
  remove as indexingRemove,
} from "../skipList";
import type { Document } from "./types";

export const apply = (doc: Document, op: Operation): number => {
  if (op.type === "insert") {
    doc.counter = Number(doc.counter) + 1;
    crdtInsert(doc.store, op);
    const idxOfLeft = findIndex(doc.skipList, op.leftOrigin);
    indexingInsert(doc.skipList, idxOfLeft + 1, op.id);
    return idxOfLeft + 1;
  }

  const index = findIndex(doc.skipList, op.target);
  crdtRemove(doc.store, op);
  indexingRemove(doc.skipList, op.target);
  return index;
};
