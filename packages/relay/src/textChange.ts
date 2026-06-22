import type { Operation } from "@repo/core";
import type { TextChange } from "./types";

export const applyTextChange = (value: string, change: TextChange): string => {
  if (change.insert) {
    return (
      value.slice(0, change.index) +
      change.insert +
      value.slice(change.index)
    );
  }

  if (change.delete) {
    return (
      value.slice(0, change.index) +
      value.slice(change.index + change.delete)
    );
  }

  return value;
};

export const toTextChange = (op: Operation, index: number): TextChange => {
  if (op.type === "insert") return { index, insert: op.value };
  return { index, delete: 1 };
};
