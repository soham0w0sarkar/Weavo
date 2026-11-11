import { describe, expect, test } from "bun:test";
import {
  createInsertOperation,
  createReplica,
  generateClientId,
  ROOT_ID,
  type ClientId,
  type OperationId,
} from "@weavo/core";
import { createMembership } from "@weavo/membership";
import { createBuffer, type StateVector } from "@weavo/sync";
import { manageTransport } from "../src/transport";
import { createMockTransport } from "./helpers/mockTransport";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as ClientId;

describe("state vector after buffered ops flush", () => {
  test("advances past ops that were applied by flushing the dependency buffer", () => {
    const doc = createReplica(generateClientId());
    const sv: StateVector = new Map();
    const { transport, deliver } = createMockTransport();
    const applied: OperationId[] = [];

    const membership = createMembership(() => {}, {
      clientId: doc.clientId,
      initialMembers: [doc.clientId],
      heartbeatIntervalMs: 0,
    });

    manageTransport(
      transport,
      doc,
      sv,
      createBuffer(),
      (op) => {
        if (op.type === "insert") applied.push(op.id);
      },
      membership,
    );
    transport.connect();

    const first = createInsertOperation(
      [ALICE, 0] as OperationId,
      "a",
      ROOT_ID,
      null,
    );
    const second = createInsertOperation(
      [ALICE, 1] as OperationId,
      "b",
      [ALICE, 0],
      null,
    );

    deliver({ type: "op", op: second });

    expect(sv.get(ALICE)).toBeUndefined();
    expect(applied).toEqual([]);

    deliver({ type: "op", op: first });

    expect(applied).toEqual([first.id, second.id]);
    expect(sv.get(ALICE)).toBe(1);
  });
});
