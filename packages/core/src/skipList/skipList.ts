import { createSkipListNode } from "./skipListNode";
import { ROOT_ID, toKey, type OperationId } from "../ids";
import type { Node } from "../store/types";
import type { SkipList, SkipListNode } from "./types";

const MAX_HEIGHT = 32;

export const createSkipList = (): SkipList => {
  const head = createSkipListNode(toKey(ROOT_ID), MAX_HEIGHT);
  const nodeMap = new Map([[toKey(ROOT_ID), head]]);
  return { head, length: 0, nodeMap };
};

const randomLevel = (): number => {
  let level = 1;
  while (Math.random() < 0.5 && level < MAX_HEIGHT) {
    level++;
  }
  return level;
};

export const findIndex = (sl: SkipList, id: OperationId): number => {
  const target = sl.nodeMap.get(toKey(id));
  if (!target) return -1;

  let index = 0;
  let current = sl.head;

  for (let lvl = MAX_HEIGHT - 1; lvl >= 0; lvl--) {
    while (current.next[lvl] !== null && current.next[lvl] !== target) {
      index += current.span[lvl];
      current = current.next[lvl]!;
    }
  }

  return index;
};

export const findByIndex = (
  sl: SkipList,
  targetIndex: number,
): SkipListNode | null => {
  let node = sl.head;
  let remaining = targetIndex;

  for (let lvl = MAX_HEIGHT - 1; lvl >= 0; lvl--) {
    while (true) {
      const next = node.next[lvl];
      const span = node.span[lvl];

      if (!next || span == null || span > remaining) break;

      remaining -= span;
      node = next;
    }
  }

  return node.next[0];
};

export const insert = (
  sl: SkipList,
  index: number,
  refCrdtId: OperationId,
): SkipListNode => {
  const update = Array(MAX_HEIGHT).fill(sl.head);
  const rank = Array(MAX_HEIGHT).fill(0);

  let currentNode = sl.head;
  let remainingSteps = index;

  for (let lvl = MAX_HEIGHT - 1; lvl >= 0; lvl--) {
    rank[lvl] = lvl === MAX_HEIGHT - 1 ? 0 : rank[lvl + 1];

    while (true) {
      const next = currentNode.next[lvl];
      const span = currentNode.span[lvl];
      if (!next || span == null || span > remainingSteps) break;

      remainingSteps -= span;
      rank[lvl] += span;
      currentNode = next;
    }
    update[lvl] = currentNode;
  }

  const level = randomLevel();
  const newNode = createSkipListNode(toKey(refCrdtId), level);
  sl.nodeMap.set(toKey(refCrdtId), newNode);

  for (let lvl = 0; lvl < level; lvl++) {
    newNode.next[lvl] = update[lvl].next[lvl];
    update[lvl].next[lvl] = newNode;

    newNode.span[lvl] = update[lvl].span[lvl] - (rank[0] - rank[lvl]);
    update[lvl].span[lvl] = rank[0] - rank[lvl] + 1;
  }

  for (let lvl = level; lvl < MAX_HEIGHT; lvl++) {
    update[lvl].span[lvl]++;
  }

  sl.length++;
  return newNode;
};

export const remove = (sl: SkipList, refCrdtId: OperationId): boolean => {
  let cur = sl.head;
  while (cur.next[0] && cur.next[0].refCrdtKey !== toKey(refCrdtId)) {
    cur = cur.next[0];
  }
  const target = cur.next[0];
  if (!target || target.refCrdtKey !== toKey(refCrdtId)) return false;

  const l0Rank = new Map<SkipListNode, number>();
  {
    let w: SkipListNode | null = sl.head;
    let r = 0;
    while (w) {
      l0Rank.set(w, r++);
      w = w.next[0];
    }
  }
  const targetRank = l0Rank.get(target);
  if (targetRank === undefined) return false;

  const update: SkipListNode[] = Array(MAX_HEIGHT).fill(null);
  for (let lvl = MAX_HEIGHT - 1; lvl >= 0; lvl--) {
    let pred = sl.head;
    while (true) {
      const nxt = pred.next[lvl];
      if (!nxt) break;
      if (nxt === target) break;
      const nxtRank = l0Rank.get(nxt);
      if (nxtRank === undefined || nxtRank > targetRank) break;
      pred = nxt;
    }
    update[lvl] = pred;
  }

  for (let lvl = 0; lvl < MAX_HEIGHT; lvl++) {
    if (update[lvl].next[lvl] !== target) {
      update[lvl].span[lvl]--;
    } else {
      update[lvl].span[lvl] += target.span[lvl] - 1;
      update[lvl].next[lvl] = target.next[lvl];
    }
  }

  sl.length--;
  sl.nodeMap.delete(toKey(refCrdtId));
  return true;
};
