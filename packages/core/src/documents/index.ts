export type { Document, OnApplied, AppliedOp } from "./types";
export { createReplica } from "./Document";
export { apply } from "./apply";
export { onBeforeInput, onInput, buildOp } from "./localApply";
