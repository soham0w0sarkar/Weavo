"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RelayTextarea } from "./RelayTextarea";
import { buildRelayRoomUrl } from "./lib/relayUrl";
import styles from "./page.module.css";

function DemoRoomContent() {
  const searchParams = useSearchParams();
  const roomFromUrl = searchParams.get("room");
  const [roomId, setRoomId] = useState<string | null>(roomFromUrl);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (roomFromUrl) {
      setRoomId(roomFromUrl);
      return;
    }

    const id = crypto.randomUUID();
    const url = new URL(window.location.href);
    url.searchParams.set("room", id);
    window.history.replaceState(null, "", url);
    setRoomId(id);
  }, [roomFromUrl]);

  const shareUrl = useMemo(() => {
    if (!roomId || typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    return url.toString();
  }, [roomId]);

  const copyShareLink = useCallback(async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  if (!roomId) {
    return <p className={styles.subtitle}>Starting room…</p>;
  }

  const relayUrl = buildRelayRoomUrl(roomId);

  return (
    <>
      <div className={styles.editors}>
        <RelayTextarea label="Editor A" relayUrl={relayUrl} />
        <RelayTextarea label="Editor B" relayUrl={relayUrl} />
      </div>
    </>
  );
}

export function DemoRoom() {
  return (
    <Suspense fallback={<p className={styles.subtitle}>Loading room…</p>}>
      <DemoRoomContent />
    </Suspense>
  );
}
