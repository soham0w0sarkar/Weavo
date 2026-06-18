import type { OperationKey } from "../ids";
import type { Node } from "../store/types";
import type { SkipListNode } from "./types";

export const createSkipListNode = (
  refCrdtKey: OperationKey,
  height: number,
): SkipListNode => {
  return {
    refCrdtKey,
    height,
    next: Array(height).fill(null),
    span: Array(height).fill(0),
  };
};
