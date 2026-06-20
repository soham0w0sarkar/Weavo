import type { OperationId } from "../ids/types";

export type InsertOperation = {
  type: "insert";
  id: OperationId;
  value: string;
  leftOrigin: OperationId;
  rightOrigin: OperationId | null;
};

export type DeleteOperation = {
  type: "delete";
  target: OperationId;
};

export type Operation = InsertOperation | DeleteOperation;
