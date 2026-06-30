"use client";

import { useCallback, useEffect, useState } from "react";
import { RelayTextarea } from "./RelayTextarea";
import { buildRelayRoomUrl } from "./lib/relayUrl";
import {
  createRoomId,
  loadStoredRoomId,
  parseRoomId,
  shortRoomId,
  storeRoomId,
} from "./lib/roomId";
import styles from "./page.module.css";

export function DemoRoom() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRoomId(loadStoredRoomId());
    setReady(true);
  }, []);

  const enterRoom = useCallback((id: string) => {
    storeRoomId(id);
    setRoomId(id);
    setJoinInput("");
    setJoinError(false);
  }, []);

  const createRoom = useCallback(() => {
    enterRoom(createRoomId());
  }, [enterRoom]);

  const joinRoom = useCallback(() => {
    const id = parseRoomId(joinInput);
    if (!id) {
      setJoinError(true);
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
    window.setTimeout(() => setCopied(false), 1500);
  }, [roomId]);

  if (!ready) return null;

  if (!roomId) {
    return (
      <div className={styles.lobby}>
        <button type="button" className={styles.createButton} onClick={createRoom}>
          New room
        </button>

        <div className={styles.divider}>
          <span />
          <span>or</span>
          <span />
        </div>

        <div className={`${styles.joinRow} ${joinError ? styles.joinRowError : ""}`}>
          <input
            type="text"
            className={styles.roomInput}
            placeholder="Room ID"
            value={joinInput}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            onChange={(e) => {
              setJoinInput(e.target.value);
              setJoinError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") joinRoom();
            }}
            aria-invalid={joinError}
          />
          <button type="button" className={styles.joinButton} onClick={joinRoom}>
            Join
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.session}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarDesktop}>
          <code className={styles.roomId} title={roomId}>
            {roomId}
          </code>
          <div className={styles.actions}>
            <button type="button" className={styles.ghostButton} onClick={copyId}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className={styles.ghostButton} onClick={createRoom}>
              New
            </button>
            <button type="button" className={styles.ghostButton} onClick={leaveRoom}>
              Leave
            </button>
          </div>
        </div>

        <div className={styles.toolbarMobile}>
          <div className={styles.mobileRoomRow}>
            <span className={styles.liveDot} aria-hidden />
            <code className={styles.roomIdShort} title={roomId}>
              {shortRoomId(roomId)}
            </code>
            <button type="button" className={styles.copyPill} onClick={copyId}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className={styles.mobileActions}>
            <button type="button" className={styles.outlineButton} onClick={createRoom}>
              New room
            </button>
            <button type="button" className={styles.outlineButton} onClick={leaveRoom}>
              Leave
            </button>
          </div>
        </div>
      </div>

      <RelayTextarea relayUrl={buildRelayRoomUrl(roomId)} />
    </div>
  );
}
