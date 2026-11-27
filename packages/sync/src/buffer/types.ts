import type {
  DeleteOperation,
  InsertOperation,
  Operation,
  OperationKey,
} from "@weavo/core";
import type { MembershipHandle } from "@weavo/membership";

export type { OperationKey, Operation } from "@weavo/core";

export type BufferReason =
  | "missing-origin"
  | "missing-target"
  | "missing-membership";

/**
 * Optional listener for what the buffer does. When none is given the buffer
 * takes no timestamps and makes no extra calls.
 */
export type BufferObserver = {
  /** An op entered the buffer. */
  buffered: (reason: BufferReason) => void;
  /** A buffered op was applied after waiting `waitedMs`. */
  released: (waitedMs: number) => void;
  /** An op arrived that was already waiting in the buffer. */
  duplicate: () => void;
};

export type OperationBuffer = {
  waiting: Map<OperationKey, Set<Operation>>;
  buffered: Map<OperationKey, InsertOperation>;
  pendingDeletes: Map<OperationKey, DeleteOperation>;
  observer: BufferObserver | null;
  /** When each waiting op was buffered. Only filled when an observer is set. */
  since: Map<string, number>;
};

export type MembershipVersions = Pick<MembershipHandle, "getVersion">;
