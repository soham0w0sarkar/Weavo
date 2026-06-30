"use client";

import { useCallback, useEffect, useState } from "react";
import { RelayTextarea } from "./RelayTextarea";
import { buildRelayRoomUrl } from "./lib/relayUrl";
import {
  createRoomId,
  loadStoredRoomId,
  parseRoomId,
  storeRoomId,
} from "./lib/roomId";
import styles from "./page.module.css";

export function DemoRoom() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRoomId(loadStoredRoomId());
    setReady(true);
  }, []);

  const enterRoom = useCallback((id: string) => {
    storeRoomId(id);
    setRoomId(id);
    setJoinInput("");
    setJoinError("");
  }, []);

  const createRoom = useCallback(() => {
    enterRoom(createRoomId());
  }, [enterRoom]);

  const joinRoom = useCallback(() => {
    const id = parseRoomId(joinInput);
    if (!id) {
      setJoinError("Enter a valid room ID");
      return;
    }
    enterRoom(id);
  }, [enterRoom, joinInput]);

  const leaveRoom = useCallback(() => {
    storeRoomId(null);
    setRoomId(null);
  }, []);

  const copyId = useCallback(async () => {
    if (!roomId) return;
    await navigator.clipboard.writeText(roomId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [roomId]);

  if (!ready) {
    return <p className={styles.subtitle}>Loading…</p>;
  }

  if (!roomId) {
    return (
      <div className={styles.lobby}>
        <p className={styles.subtitle}>
          Create a room and copy the ID for someone else to join.
        </p>

        <div className={styles.lobbyPanel}>
          <h2 className={styles.panelTitle}>Create</h2>
          <p className={styles.panelHint}>Opens a new room with one editor.</p>
          <button type="button" className={styles.primaryButton} onClick={createRoom}>
            Generate room
          </button>
        </div>

        <div className={styles.lobbyPanel}>
          <h2 className={styles.panelTitle}>Join</h2>
          <p className={styles.panelHint}>Paste the room ID you were given.</p>
          <div className={styles.joinRow}>
            <input
              type="text"
              className={styles.roomInput}
              placeholder="e.g. ab817c66-908e-43f4-ad47-3e7bd52b3385"
              value={joinInput}
              onChange={(e) => {
                setJoinInput(e.target.value);
                setJoinError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") joinRoom();
              }}
            />
            <button type="button" className={styles.primaryButton} onClick={joinRoom}>
              Join
            </button>
          </div>
          {joinError ? <p className={styles.error}>{joinError}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={styles.room}>
        <p className={styles.subtitle}>
          Copy the room ID — others paste it under Join on this page.
        </p>
        <div className={styles.roomBar}>
          <code className={styles.roomId}>{roomId}</code>
          <button type="button" className={styles.copyButton} onClick={copyId}>
            {copied ? "Copied" : "Copy ID"}
          </button>
          <button type="button" className={styles.copyButton} onClick={createRoom}>
            New room
          </button>
          <button type="button" className={styles.copyButton} onClick={leaveRoom}>
            Leave
          </button>
        </div>
      </div>

      <RelayTextarea relayUrl={buildRelayRoomUrl(roomId)} />
    </>
  );
}
