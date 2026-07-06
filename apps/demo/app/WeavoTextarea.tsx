"use client";

import { useEffect, useRef } from "react";
import { createWeavo } from "@weavo/client";
import {
  appendRoomDelta,
  hasRoomSnapshot,
  loadRoomStorage,
  saveRoomSnapshot,
} from "./lib/roomStorage";

const CHECKPOINT_EVERY_OPS = 50;

export function WeavoTextarea({
  weavoUrl,
  roomId,
}: {
  weavoUrl: string;
  roomId: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const stored = loadRoomStorage(roomId);
    let opsSinceCheckpoint = 0;

    const weavo = createWeavo(weavoUrl, {
      initial: stored?.snapshot
        ? { snapshot: stored.snapshot, delta: stored.delta }
        : undefined,
      onOp(op) {
        appendRoomDelta(roomId, op);
        opsSinceCheckpoint++;
        if (
          opsSinceCheckpoint >= CHECKPOINT_EVERY_OPS ||
          !hasRoomSnapshot(roomId)
        ) {
          saveRoomSnapshot(roomId, weavo.snapshot());
          opsSinceCheckpoint = 0;
        }
      },
    });

    const checkpoint = () => {
      saveRoomSnapshot(roomId, weavo.snapshot());
      opsSinceCheckpoint = 0;
    };

    const unbind = weavo.bind(el);

    const onPageHide = () => checkpoint();
    window.addEventListener("pagehide", onPageHide);

    return () => {
      checkpoint();
      window.removeEventListener("pagehide", onPageHide);
      unbind();
      weavo.disconnect();
    };
  }, [weavoUrl, roomId]);

  return (
    <textarea
      ref={textareaRef}
      className="editor-textarea"
      defaultValue=""
      placeholder="Start typing…"
      rows={10}
      spellCheck={false}
    />
  );
}
