import type { InputSnapshot, TextChange } from "./types";

export type { InputSnapshot };

export const transformPosition = (pos: number, change: TextChange): number => {
  const { index, insert, delete: del } = change;
  if (insert) return pos >= index ? pos + insert.length : pos;
  if (del) {
    if (pos > index + del) return pos - del;
    if (pos > index) return index;
    return pos;
  }
  return pos;
};

export const transformSnapshot = (
  snapshot: InputSnapshot,
  change: TextChange,
): InputSnapshot => {
  const { index, insert, delete: del } = change;
  let { start, end, value } = snapshot;

  if (insert) {
    value = value.slice(0, index) + insert + value.slice(index);
    if (start >= index) start += insert.length;
    if (end >= index) end += insert.length;
  } else if (del) {
    value = value.slice(0, index) + value.slice(index + del);
    if (start > index + del) start -= del;
    else if (start > index) start = index;
    if (end > index + del) end -= del;
    else if (end > index) end = index;
  }

  return { start, end, value };
};
