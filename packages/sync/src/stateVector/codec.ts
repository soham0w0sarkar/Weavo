import type { ClientId } from "@relay/code";
import type { StateVector } from "./type";

export type StateVectorWire = Record<ClientId, number>;

export const encodeStateVector = (sv: StateVector): StateVectorWire =>
  Object.fromEntries(sv);

export const decodeStateVector = (wire: StateVectorWire): StateVector =>
  new Map(Object.entries(wire));
