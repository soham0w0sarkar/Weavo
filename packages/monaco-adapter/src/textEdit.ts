import type { TextEdit } from "./types";

export const textEditFromDiff = (
  oldValue: string,
  newValue: string,
): TextEdit | null => {
  if (oldValue === newValue) return null;

  let start = 0;
  while (
    start < oldValue.length &&
    start < newValue.length &&
    oldValue[start] === newValue[start]
  ) {
    start++;
  }

  let oldEnd = oldValue.length;
  let newEnd = newValue.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldValue[oldEnd - 1] === newValue[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }

  return {
    index: start,
    delete: oldEnd - start,
    insert: newValue.slice(start, newEnd),
  };
};
