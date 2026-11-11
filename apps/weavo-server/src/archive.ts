import { Database } from "bun:sqlite";
import {
  apply,
  createReplica,
  getText,
  restoreFromStorage,
  takeSnapshot,
  toKey,
  type ClientId,
  type Document,
  type Operation,
} from "@weavo/core";
import {
  buildMembership,
  commit,
  createMembershipStore,
  get,
  getClientId,
  getShortId,
  type Membership,
  type MembershipStore,
} from "@weavo/membership";
import {
  addToBuffer,
  canApply,
  createBuffer,
  flush,
  flushMembership,
  update,
  type OperationBuffer,
  type StateVector,
} from "@weavo/sync";
import {
  decodeDocumentSnapshot,
  decodeMessage,
  encodeDocumentSnapshot,
  encodeMessage,
  encodeRoomDocument,
  isMembershipMessage,
  type IdCodec,
  type Message,
} from "@weavo/transport";

const SERVER_CLIENT_ID = "7e4e0000-0000-4000-8000-000000000001" as ClientId;

type RoomRecord = {
  id: string;
  doc: Document;
  sv: StateVector;
  buffer: OperationBuffer;
  membership: MembershipStore;
  requestedVersions: Set<number>;
  knownMembershipVersions: Set<number>;
};

export type DocumentArchive = {
  readonly path: string;
  observe(
    room: string,
    bytes: Uint8Array,
    publish: (bytes: Uint8Array) => void,
  ): void;
  /** Encoded room document, or null when this room has nothing stored. */
  bytes(room: string): Uint8Array | null;
  close(): void;
};

const isOpPresent = (doc: Document, op: Operation): boolean => {
  const node = doc.store.nodes.get(
    toKey(op.type === "insert" ? op.id : op.target),
  );
  if (!node) return false;
  if (op.type === "delete") return node.tombstone;
  return true;
};

const applyOp = (room: RoomRecord, op: Operation) => {
  if (isOpPresent(room.doc, op)) return;

  if (!canApply(room.doc, op)) {
    addToBuffer(room.buffer, room.doc, op);
    return;
  }

  apply(room.doc, op);
  if (op.type === "insert") update(room.sv, op.id);

  for (const applied of flush(room.buffer, room.doc, op)) {
    if (applied.op.type === "insert") update(room.sv, applied.op.id);
  }
};

const rememberMembership = (room: RoomRecord, membership: Membership) => {
  const previous = room.membership.currentVersion;
  commit(room.membership, membership);
  if (membership.version < previous) {
    room.membership.currentVersion = previous;
  }
  room.knownMembershipVersions.add(membership.version);

  for (const applied of flushMembership(room.buffer, room.doc, {
    getVersion: (version) => get(room.membership, version),
  })) {
    if (applied.op.type === "insert") update(room.sv, applied.op.id);
  }
};

const membershipOf = (message: Message): Membership | null => {
  if (
    message.type === "COMMIT" ||
    message.type === "JOIN_RESPONSE" ||
    message.type === "MEMBERSHIP_RESPONSE"
  ) {
    return message.membership;
  }
  return null;
};

const codecFor = (
  room: RoomRecord,
  publish: (bytes: Uint8Array) => void,
): IdCodec => ({
  encodeVersion: () => room.membership.currentVersion,
  shortIdOf: (clientId) => {
    const table = get(room.membership, room.membership.currentVersion);
    return table ? getShortId(table, clientId) : null;
  },
  clientIdOf: (version, shortId) => {
    const table = get(room.membership, version);
    return table ? getClientId(table, shortId) : null;
  },
  hasVersion: (version) => get(room.membership, version) !== null,
  onMissingVersion: (version) => {
    if (room.requestedVersions.has(version)) return;
    if (get(room.membership, version)) return;
    room.requestedVersions.add(version);
    publish(
      encodeMessage({
        type: "MEMBERSHIP_REQUEST",
        version,
        requesterId: SERVER_CLIENT_ID,
      }),
    );
  },
});

const hasData = (room: RoomRecord) =>
  room.sv.size > 0 || getText(room.doc.store).length > 0;

export const createDocumentArchive = (path: string): DocumentArchive => {
  const db = new Database(path, { create: true });
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      room TEXT PRIMARY KEY,
      snapshot BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memberships (
      room TEXT NOT NULL,
      version INTEGER NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (room, version)
    );
  `);

  const readDocument = db.query<{ snapshot: Uint8Array }, [string]>(
    "SELECT snapshot FROM documents WHERE room = ?",
  );
  const writeDocument = db.query<unknown, [string, Uint8Array]>(
    `INSERT INTO documents (room, snapshot) VALUES (?, ?)
     ON CONFLICT(room) DO UPDATE SET snapshot = excluded.snapshot`,
  );
  const readMemberships = db.query<{ version: number; body: string }, [string]>(
    "SELECT version, body FROM memberships WHERE room = ? ORDER BY version",
  );
  const writeMembership = db.query<unknown, [string, number, string]>(
    `INSERT INTO memberships (room, version, body) VALUES (?, ?, ?)
     ON CONFLICT(room, version) DO UPDATE SET body = excluded.body`,
  );

  const rooms = new Map<string, RoomRecord>();

  const persist = (room: RoomRecord) => {
    if (!hasData(room)) return;
    writeDocument.run(
      room.id,
      encodeDocumentSnapshot(takeSnapshot(room.doc, room.sv)),
    );
    for (const version of room.knownMembershipVersions) {
      const membership = get(room.membership, version);
      if (!membership || version === 0) continue;
      writeMembership.run(room.id, version, JSON.stringify(membership));
    }
  };

  const load = (id: string): RoomRecord => {
    const room: RoomRecord = {
      id,
      doc: createReplica(SERVER_CLIENT_ID),
      sv: new Map(),
      buffer: createBuffer(),
      membership: createMembershipStore(buildMembership(0, [])),
      requestedVersions: new Set(),
      knownMembershipVersions: new Set(),
    };

    for (const row of readMemberships.all(id)) {
      rememberMembership(room, JSON.parse(row.body) as Membership);
    }

    const stored = readDocument.get(id);
    if (stored?.snapshot) {
      try {
        const restored = restoreFromStorage(
          decodeDocumentSnapshot(stored.snapshot),
        );
        room.doc = restored.doc;
        room.sv = restored.stateVector;
      } catch (error) {
        console.warn(
          `ignored stored snapshot for "${id}": ${error instanceof Error ? error.message : "undecodable"}`,
        );
      }
    }

    return room;
  };

  const roomFor = (id: string) => {
    const existing = rooms.get(id);
    if (existing) return existing;
    const room = load(id);
    rooms.set(id, room);
    return room;
  };

  return {
    path,
    observe(id, bytes, publish) {
      const room = roomFor(id);
      let message: Message;
      try {
        message = decodeMessage(bytes, codecFor(room, publish));
      } catch (error) {
        console.warn(
          `skipped room "${id}" frame: ${error instanceof Error ? error.message : "undecodable"}`,
        );
        return;
      }

      if (isMembershipMessage(message)) {
        const membership = membershipOf(message);
        if (!membership) return;
        rememberMembership(room, membership);
        persist(room);
        return;
      }

      if (message.type === "op") applyOp(room, message.op);
      if (message.type === "sync-response") {
        for (const op of message.ops) applyOp(room, op);
      }
      persist(room);
    },
    bytes(id) {
      const room = roomFor(id);
      if (!hasData(room)) return null;
      return encodeRoomDocument({
        snapshot: takeSnapshot(room.doc, room.sv),
        delta: [],
      });
    },
    close() {
      if (path !== ":memory:") db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
    },
  };
};

/** `undefined` uses `weavo.sqlite`. `off`, `0`, and `""` leave the relay memory-only. */
export const openDocumentArchive = (): DocumentArchive | null => {
  const configured = process.env.WEAVO_DB;
  const path = configured === undefined ? "weavo.sqlite" : configured;
  if (path === "" || path === "off" || path === "0") return null;

  try {
    return createDocumentArchive(path);
  } catch (error) {
    console.warn(
      `document database unavailable (${path}): ${error instanceof Error ? error.message : "open failed"}`,
    );
    return null;
  }
};

export const DOCUMENT_MEDIA_TYPE = "application/vnd.weavo.document";
