import type { ClientId, OperationId } from "./types";

const compareClientId = (a: ClientId, b: ClientId): number => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

export const compareOperationId = (a: OperationId, b: OperationId): number => {
  if (a[1] < b[1]) return -1;
  if (a[1] > b[1]) return 1;

  return compareClientId(a[0], b[0]);
};
