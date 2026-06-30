import { createSkipListNode } from "./skipListNode";
import { ROOT_ID, toKey, type OperationId } from "../ids";
import type { SkipList, SkipListNode } from "./types";

const MAX_HEIGHT = 32;

export const createSkipList = (): SkipList => {
  const head = createSkipListNode(toKey(ROOT_ID), MAX_HEIGHT);
  const nodeMap = new Map([[toKey(ROOT_ID), head]]);
  return { head, length: 0, nodeMap };
};

export const findIndex = (sl: SkipList, id: OperationId): number => {
  const targetKey = toKey(id);
  let index = 0;
  let current: SkipListNode | null = sl.head.next[0] ?? null;

  while (current) {
    if (current.refCrdtKey === targetKey) return index;
    index++;
    current = current.next[0] ?? null;
  }

  return -1;
};

export const findByIndex = (
  sl: SkipList,
  targetIndex: number,
): SkipListNode | null => {
  if (targetIndex < 0 || targetIndex >= sl.length) return null;

  let current: SkipListNode | null = sl.head.next[0] ?? null;
  for (let i = 0; i < targetIndex && current; i++) {
    current = current.next[0] ?? null;
  }

  return current;
};

export const insert = (
  sl: SkipList,
  index: number,
  refCrdtId: OperationId,
): SkipListNode => {
  let pred = sl.head;
  for (let i = 0; i < index; i++) {
    pred = pred.next[0]!;
  }

  const newNode = createSkipListNode(toKey(refCrdtId), 1);
  sl.nodeMap.set(toKey(refCrdtId), newNode);
  newNode.next[0] = pred.next[0] ?? null;
  pred.next[0] = newNode;
  sl.length++;
  return newNode;
};

export const remove = (sl: SkipList, refCrdtId: OperationId): boolean => {
  let pred = sl.head;
  while (pred.next[0] && pred.next[0].refCrdtKey !== toKey(refCrdtId)) {
    pred = pred.next[0]!;
  }

  const target = pred.next[0];
  if (!target || target.refCrdtKey !== toKey(refCrdtId)) return false;

  pred.next[0] = target.next[0] ?? null;
  sl.length--;
  sl.nodeMap.delete(toKey(refCrdtId));
  return true;
};
