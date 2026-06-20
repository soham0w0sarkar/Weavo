import type { ClientId } from "@repo/core";
import type { StateVector } from "./type";

export type StateVectorWire = Record<ClientId, number>;

export const encodeStateVector = (sv: StateVector): StateVectorWire =>
  Object.fromEntries(sv);

export const decodeStateVector = (wire: StateVectorWire): StateVector =>
  new Map(Object.entries(wire));
