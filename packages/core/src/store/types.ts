import type { OperationId, OperationKey } from "../ids/types";

export type Node = {
  id: OperationId;
  value: string;
  tombstone: boolean;
  leftOrigin: OperationId | null;
  rightOrigin: OperationId | null;
  next: Node | null;
};

export type SubscribeToText = {
  subscribe: (fn: (text: string) => void) => void;
  emit: () => void;
};

export type NodeStore = {
  root: Node;
  nodes: Map<OperationKey, Node>;
};
