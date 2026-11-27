import { describe, expect, test } from "bun:test";
import {
  apply,
  createInsertOperation,
  createReplica,
  generateOperationId,
  getText,
  ROOT_ID,
  type ClientId,
} from "@weavo/core";
import {
  addToBuffer,
  bufferSize,
  createBuffer,
  flush,
  flushMembership,
  unresolvedClientId,
  type BufferObserver,
  type BufferReason,
} from "../src/buffer";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as ClientId;
const BOB = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" as ClientId;

const watch = () => {
  const seen = {
    buffered: [] as BufferReason[],
    released: [] as number[],
    duplicates: 0,
  };
  const observer: BufferObserver = {
    buffered: (reason) => seen.buffered.push(reason),
    released: (waitedMs) => seen.released.push(waitedMs),
    duplicate: () => {
      seen.duplicates++;
    },
  };
  return { seen, observer };
};

const dependentInsert = () => {
  const left = generateOperationId(BOB, 0);
  return {
    left,
    leftOp: createInsertOperation(left, "x", ROOT_ID, null),
    dependent: createInsertOperation(
      generateOperationId(ALICE, 0),
      "a",
      left,
      null,
    ),
  };
};

const membershipOf = (version: number, members: ClientId[]) => ({
  getVersion: (asked: number) =>
    asked === version
      ? {
          version,
          members: members.map((clientId, shortId) => ({ clientId, shortId })),
        }
      : null,
});

describe("buffer observer", () => {
  test("without an observer nothing is stamped", () => {
    const doc = createReplica(ALICE);
    const buffer = createBuffer();
    const { leftOp, dependent } = dependentInsert();

    addToBuffer(buffer, doc, dependent);
    apply(doc, leftOp);
    flush(buffer, doc, leftOp);

    expect(buffer.observer).toBeNull();
    expect(buffer.since.size).toBe(0);
    expect(getText(doc.store)).toBe("xa");
  });

  test("an insert missing its origin reports missing-origin", () => {
    const doc = createReplica(ALICE);
    const { seen, observer } = watch();
    const buffer = createBuffer(observer);

    addToBuffer(buffer, doc, dependentInsert().dependent);

    expect(seen.buffered).toEqual(["missing-origin"]);
    expect(seen.released).toEqual([]);
    expect(bufferSize(buffer)).toBe(1);
  });

  test("a delete missing its target reports missing-target", () => {
    const doc = createReplica(ALICE);
    const { seen, observer } = watch();
    const buffer = createBuffer(observer);

    addToBuffer(buffer, doc, {
      type: "delete",
      target: generateOperationId(BOB, 0),
    });

    expect(seen.buffered).toEqual(["missing-target"]);
    expect(bufferSize(buffer)).toBe(1);
  });

  test("an unresolved shortId reports missing-membership, even if the origin is also missing", () => {
    const doc = createReplica(ALICE);
    const { seen, observer } = watch();
    const buffer = createBuffer(observer);

    addToBuffer(
      buffer,
      doc,
      createInsertOperation(
        [unresolvedClientId(3, 1), 0],
        "a",
        generateOperationId(ALICE, 9),
        null,
      ),
    );

    expect(seen.buffered).toEqual(["missing-membership"]);
  });

  test("applying a buffered insert reports one release with its wait", async () => {
    const doc = createReplica(ALICE);
    const { seen, observer } = watch();
    const buffer = createBuffer(observer);
    const { leftOp, dependent } = dependentInsert();

    addToBuffer(buffer, doc, dependent);
    await Bun.sleep(15);
    apply(doc, leftOp);
    flush(buffer, doc, leftOp);

    expect(seen.released).toHaveLength(1);
    expect(seen.released[0]!).toBeGreaterThanOrEqual(10);
    expect(seen.released[0]!).toBeLessThan(500);
    expect(buffer.since.size).toBe(0);
    expect(bufferSize(buffer)).toBe(0);
  });

  test("a chain releases every op, each with its own wait", () => {
    const doc = createReplica(ALICE);
    const { seen, observer } = watch();
    const buffer = createBuffer(observer);
    const a = generateOperationId(BOB, 0);
    const b = generateOperationId(BOB, 1);
    const c = generateOperationId(BOB, 2);
    const root = createInsertOperation(a, "a", ROOT_ID, null);

    addToBuffer(buffer, doc, createInsertOperation(c, "c", b, null));
    addToBuffer(buffer, doc, createInsertOperation(b, "b", a, null));
    apply(doc, root);
    flush(buffer, doc, root);

    expect(seen.buffered).toEqual(["missing-origin", "missing-origin"]);
    expect(seen.released).toHaveLength(2);
    expect(getText(doc.store)).toBe("abc");
    expect(buffer.since.size).toBe(0);
  });

  test("a pending delete is released when its delete is applied", () => {
    const doc = createReplica(ALICE);
    const { seen, observer } = watch();
    const buffer = createBuffer(observer);
    const target = generateOperationId(BOB, 0);
    const del = { type: "delete" as const, target };

    addToBuffer(buffer, doc, del);
    apply(doc, createInsertOperation(target, "a", ROOT_ID, null));
    flush(buffer, doc, del);

    expect(seen.released).toHaveLength(1);
    expect(buffer.since.size).toBe(0);
    expect(bufferSize(buffer)).toBe(0);
  });

  test("an op delivered twice while waiting counts once, then as a duplicate", () => {
    const doc = createReplica(ALICE);
    const { seen, observer } = watch();
    const buffer = createBuffer(observer);
    const { leftOp, dependent } = dependentInsert();

    addToBuffer(buffer, doc, dependent);
    addToBuffer(buffer, doc, { ...dependent });

    expect(seen.buffered).toEqual(["missing-origin"]);
    expect(seen.duplicates).toBe(1);
    expect(bufferSize(buffer)).toBe(1);

    apply(doc, leftOp);
    flush(buffer, doc, leftOp);

    expect(seen.released).toHaveLength(1);
    expect(buffer.since.size).toBe(0);
  });

  test("buffered minus released always equals what is still waiting", () => {
    const doc = createReplica(ALICE);
    const { seen, observer } = watch();
    const buffer = createBuffer(observer);
    const first = dependentInsert();
    const second = generateOperationId(BOB, 5);

    addToBuffer(buffer, doc, first.dependent);
    addToBuffer(
      buffer,
      doc,
      createInsertOperation(generateOperationId(ALICE, 1), "q", second, null),
    );
    expect(seen.buffered.length - seen.released.length).toBe(
      bufferSize(buffer),
    );

    apply(doc, first.leftOp);
    flush(buffer, doc, first.leftOp);
    expect(seen.buffered.length - seen.released.length).toBe(
      bufferSize(buffer),
    );
    expect(bufferSize(buffer)).toBe(1);
  });

  test("an op parked on a membership version keeps its wait through resolution", async () => {
    const doc = createReplica(ALICE);
    const { seen, observer } = watch();
    const buffer = createBuffer(observer);

    addToBuffer(
      buffer,
      doc,
      createInsertOperation([unresolvedClientId(3, 1), 0], "a", ROOT_ID, null),
    );
    await Bun.sleep(15);
    const applied = flushMembership(buffer, doc, membershipOf(3, [ALICE, BOB]));

    expect(applied).toHaveLength(1);
    expect(seen.buffered).toEqual(["missing-membership"]);
    expect(seen.released).toHaveLength(1);
    expect(seen.released[0]!).toBeGreaterThanOrEqual(10);
    expect(buffer.since.size).toBe(0);
  });

  test("an op that resolves but still lacks its origin is not counted twice", async () => {
    const doc = createReplica(ALICE);
    const { seen, observer } = watch();
    const buffer = createBuffer(observer);
    const missingLeft = generateOperationId(ALICE, 7);

    addToBuffer(
      buffer,
      doc,
      createInsertOperation(
        [unresolvedClientId(3, 1), 0],
        "z",
        missingLeft,
        null,
      ),
    );
    await Bun.sleep(15);
    flushMembership(buffer, doc, membershipOf(3, [ALICE, BOB]));

    expect(seen.buffered).toEqual(["missing-membership"]);
    expect(seen.duplicates).toBe(0);
    expect(seen.released).toEqual([]);
    expect(bufferSize(buffer)).toBe(1);

    const leftOp = createInsertOperation(missingLeft, "x", ROOT_ID, null);
    apply(doc, leftOp);
    flush(buffer, doc, leftOp);

    expect(seen.released).toHaveLength(1);
    expect(seen.released[0]!).toBeGreaterThanOrEqual(10);
    expect(getText(doc.store)).toBe("xz");
    expect(buffer.since.size).toBe(0);
  });
});
