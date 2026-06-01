import type { InsertOperation, DeleteOperation } from "@repo/core";

export type Operation = InsertOperation | DeleteOperation;

export type Transport = {
  send: (op: Operation) => void;
  onReceive: (cb: (op: Operation) => void) => void;
  connect: () => void;
  disconnect: () => void;
};
