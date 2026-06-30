"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RelayTextarea } from "./RelayTextarea";
import { buildRelayRoomUrl } from "./lib/relayUrl";
import { createRoomId, parseRoomId } from "./lib/roomId";
import styles from "./page.module.css";

function DemoRoomContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomFromUrl = searchParams.get("room");

  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState("");
  const [copied, setCopied] = useState<"id" | "link" | null>(null);

  const shareUrl = useMemo(() => {
    if (!roomFromUrl || typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomFromUrl);
    return url.toString();
  }, [roomFromUrl]);

  const goToRoom = useCallback(
    (roomId: string) => {
      const url = new URL(window.location.href);
      url.searchParams.set("room", roomId);
      router.push(`${url.pathname}${url.search}`);
    },
    [router],
  );

  const createRoom = useCallback(() => {
    setJoinError("");
    goToRoom(createRoomId());
  }, [goToRoom]);

  const joinRoom = useCallback(() => {
    const roomId = parseRoomId(joinInput);
    if (!roomId) {
      setJoinError("Paste a room ID or share link");
      return;
    }
    setJoinError("");
    goToRoom(roomId);
  }, [goToRoom, joinInput]);

  const copy = useCallback(async (kind: "id" | "link", text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 2000);
  }, []);

  if (!roomFromUrl) {
    return (
      <div className={styles.lobby}>
        <p className={styles.subtitle}>
          Create a room and share the ID, or join one someone sent you.
        </p>

        <div className={styles.lobbyPanel}>
          <h2 className={styles.panelTitle}>Create</h2>
          <p className={styles.panelHint}>
            Generates a new room and opens the editor.
          </p>
          <button type="button" className={styles.primaryButton} onClick={createRoom}>
            Generate room
          </button>
        </div>

        <div className={styles.lobbyPanel}>
          <h2 className={styles.panelTitle}>Join</h2>
          <p className={styles.panelHint}>
            Paste a room ID or full share link.
          </p>
          <div className={styles.joinRow}>
            <input
              type="text"
              className={styles.roomInput}
              placeholder="Room ID or link"
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

  const relayUrl = buildRelayRoomUrl(roomFromUrl);

  return (
    <>
      <div className={styles.room}>
        <p className={styles.subtitle}>
          Share the room ID so others can join and edit together.
        </p>
        <div className={styles.roomBar}>
          <code className={styles.roomId}>{roomFromUrl}</code>
          <button
            type="button"
            className={styles.copyButton}
            onClick={() => copy("id", roomFromUrl)}
          >
            {copied === "id" ? "Copied" : "Copy ID"}
          </button>
          <button
            type="button"
            className={styles.copyButton}
            onClick={() => copy("link", shareUrl)}
          >
            {copied === "link" ? "Copied" : "Copy link"}
          </button>
          <button type="button" className={styles.copyButton} onClick={createRoom}>
            New room
          </button>
        </div>
      </div>

      <RelayTextarea relayUrl={relayUrl} />
    </>
  );
}

export function DemoRoom() {
  return (
    <Suspense fallback={<p className={styles.subtitle}>Loading…</p>}>
      <DemoRoomContent />
    </Suspense>
  );
}
