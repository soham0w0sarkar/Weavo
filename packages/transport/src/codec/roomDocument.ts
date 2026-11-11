import type { DocumentSnapshot, Operation } from "@weavo/core";
import {
  assertFullyRead,
  createReader,
  createWriter,
  readBytes,
  readU8,
  toBytes,
  writeBytes,
  writeU8,
} from "./buffer";
import {
  decodeDelta,
  decodeDocumentSnapshot,
  encodeDelta,
  encodeDocumentSnapshot,
} from "./persistence";
import { readVarint, writeVarint } from "./varint";

export const ROOM_DOCUMENT_VERSION = 1;

export type RoomDocument = {
  snapshot: DocumentSnapshot;
  delta: Operation[];
};

export const encodeRoomDocument = (document: RoomDocument): Uint8Array => {
  const snapshot = encodeDocumentSnapshot(document.snapshot);
  const delta = encodeDelta(document.delta);
  const writer = createWriter();
  writeU8(writer, ROOM_DOCUMENT_VERSION);
  writeVarint(writer, snapshot.length);
  writeBytes(writer, snapshot);
  writeVarint(writer, delta.length);
  writeBytes(writer, delta);
  return toBytes(writer);
};

export const decodeRoomDocument = (bytes: Uint8Array): RoomDocument => {
  const reader = createReader(bytes);
  const version = readU8(reader);
  if (version !== ROOM_DOCUMENT_VERSION) {
    throw new Error(`Unsupported room document version: ${version}`);
  }

  const snapshot = decodeDocumentSnapshot(
    readBytes(reader, readVarint(reader)),
  );
  const delta = decodeDelta(readBytes(reader, readVarint(reader)));
  assertFullyRead(reader);
  return { snapshot, delta };
};
