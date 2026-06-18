import type { DeleteOperation, InsertOperation } from "../operations/types";
import { insert as crdtInsert, remove as crdtRemove } from "../store";
import {
  findIndex,
  insert as indexingInsert,
  remove as indexingRemove,
} from "../skipList";
import type { Document } from "./types";

export const apply = (doc: Document, op: InsertOperation | DeleteOperation) => {
  if (op.type === "insert") {
    doc.counter = Number(doc.counter) + 1;
    crdtInsert(doc.store, op);
    const idxOfLeft = findIndex(doc.skipList, op.leftOrigin);
    indexingInsert(doc.skipList, idxOfLeft + 1, op.id);
  } else {
    crdtRemove(doc.store, op);
  }
};
