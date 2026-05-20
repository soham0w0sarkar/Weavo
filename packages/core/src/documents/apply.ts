import type { DeleteOperation, InsertOperation } from "../operations/types";
import { insert, remove } from "../store";
import type { Document } from "./types";

export const apply = (doc: Document, op: InsertOperation | DeleteOperation) => {
  doc.counter = Number(doc.counter) + 1;
  if (op.type === "insert") {
    insert(doc.store, op);
  } else {
    remove(doc.store, op);
  }
};
