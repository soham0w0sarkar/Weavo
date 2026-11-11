import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInsertOperation,
  getText,
  restoreFromStorage,
  ROOT_ID,
  type ClientId,
  type OperationId,
} from "@weavo/core";
import {
  decodeRoomDocument,
  encodeMessage,
  uuidOnlyCodec,
  type IdCodec,
} from "@weavo/transport";
import { createDocumentArchive } from "./archive";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as ClientId;

const memberCodec = (): IdCodec => ({
  encodeVersion: () => 1,
  shortIdOf: (clientId) => (clientId === ALICE ? 0 : null),
  clientIdOf: (_version, shortId) => (shortId === 0 ? ALICE : null),
  hasVersion: () => true,
});

const textOf = (
  archive: ReturnType<typeof createDocumentArchive>,
  room: string,
) => {
  const bytes = archive.bytes(room);
  if (!bytes) return "";
  const document = decodeRoomDocument(bytes);
  const restored = restoreFromStorage(document.snapshot, document.delta);
  return getText(restored.doc.store);
};

describe("room document archive", () => {
  test("empty room has nothing to sync", () => {
    const archive = createDocumentArchive(":memory:");
    expect(archive.bytes("room")).toBeNull();
    archive.close();
  });

  test("stores ops and reloads them for the next joiner", () => {
    const dir = mkdtempSync(join(tmpdir(), "weavo-db-"));
    const path = join(dir, "weavo.sqlite");
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

    const archive = createDocumentArchive(path);
    archive.observe(
      "notes",
      encodeMessage({ type: "op", op: first }, uuidOnlyCodec),
      () => {},
    );
    archive.observe(
      "notes",
      encodeMessage({
        type: "COMMIT",
        version: 1,
        membership: {
          version: 1,
          members: [{ clientId: ALICE, shortId: 0 }],
        },
      }),
      () => {},
    );
    archive.observe(
      "notes",
      encodeMessage({ type: "op", op: second }, memberCodec()),
      () => {},
    );
    expect(textOf(archive, "notes")).toBe("ab");
    archive.close();

    const reopened = createDocumentArchive(path);
    expect(textOf(reopened, "notes")).toBe("ab");
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
