import type { OperationKey } from "../ids";
import type { Node } from "../store/types";

export type SkipListNode = {
  refCrdtKey: OperationKey;
  height: number;
  next: (SkipListNode | null)[];
  span: number[];
};

export type SkipList = {
  head: SkipListNode;
  length: number;
  nodeMap: Map<OperationKey, SkipListNode>;
};
