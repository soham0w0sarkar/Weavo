import type { OperationId } from "@repo/core";
import type { StateVector } from "./type";

export const update = (sv: StateVector, id: OperationId) => {
  const [clientId, clock] = id;
  const current = sv.get(clientId) ?? -1;

  if (clock > current) sv.set(clientId, clock);
};

export const missingOps = (
  mineSv: StateVector,
  theirSv: StateVector,
): OperationId[] => {
  const result: OperationId[] = []

  mineSv.forEach((myClock, clientId) => {
    const theirClock = theirSv.get(clientId) ?? -1
    for (let clock = theirClock + 1; clock <= myClock; clock++) {
      result.push([clientId, clock])
    }
  })

  return result
}
