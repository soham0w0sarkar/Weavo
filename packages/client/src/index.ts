export { createWeavo } from "./Document";
export type { Weavo, WeavoOptions } from "./Document";
export { transformPosition, transformSnapshot } from "./inputSnapshot";
export {
  applyTextChange,
  textChangeFromDiff,
  toTextChange,
} from "./textChange";
export type {
  InputSnapshot,
  LocalInput,
  RemoteChange,
  TextChange,
  WeavoAdapter,
  WeavoAdapterHost,
} from "./types";
export type { DocumentSnapshot, Operation } from "@weavo/core";
export type { PeerPresence } from "@weavo/membership";
