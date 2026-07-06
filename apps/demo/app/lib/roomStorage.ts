import type { DocumentSnapshot, Operation } from "@weavo/client";

const snapshotKey = (roomId: string) => `weavo:demo:snapshot:${roomId}`;
const deltaKey = (roomId: string) => `weavo:demo:delta:${roomId}`;

export type RoomStorage = {
  snapshot: DocumentSnapshot | null;
  delta: Operation[];
};

export function loadRoomStorage(roomId: string): RoomStorage | null {
  if (typeof localStorage === "undefined") return null;

  const snapshotRaw = localStorage.getItem(snapshotKey(roomId));
  const deltaRaw = localStorage.getItem(deltaKey(roomId));

  if (!snapshotRaw && !deltaRaw) return null;

  return {
    snapshot: snapshotRaw ? (JSON.parse(snapshotRaw) as DocumentSnapshot) : null,
    delta: deltaRaw ? (JSON.parse(deltaRaw) as Operation[]) : [],
  };
}

export function appendRoomDelta(roomId: string, op: Operation) {
  const existing = loadRoomStorage(roomId)?.delta ?? [];
  existing.push(op);
  localStorage.setItem(deltaKey(roomId), JSON.stringify(existing));
}

export function saveRoomSnapshot(roomId: string, snapshot: DocumentSnapshot) {
  localStorage.setItem(snapshotKey(roomId), JSON.stringify(snapshot));
  localStorage.setItem(deltaKey(roomId), JSON.stringify([]));
}

export function hasRoomSnapshot(roomId: string): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(snapshotKey(roomId)) !== null;
}

export function clearRoomStorage(roomId: string) {
  localStorage.removeItem(snapshotKey(roomId));
  localStorage.removeItem(deltaKey(roomId));
}
