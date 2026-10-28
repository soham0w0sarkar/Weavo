"use client";

import { useCallback, useRef, useState } from "react";
import { textareaAdapter } from "@weavo/textarea-adapter";
import { RemoteCursors } from "./RemoteCursors";
import { useWeavoEditor } from "./useWeavoEditor";

const getTextareaText = (el: HTMLTextAreaElement) => el.value;

export function WeavoTextarea({
  weavoUrl,
  skipRestoreOnce = false,
  displayName,
  displayColor,
}: {
  weavoUrl: string;
  /** Skip restoring local storage once (after joining a new room). */
  skipRestoreOnce?: boolean;
  displayName: string;
  displayColor: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [textarea, setTextarea] = useState<HTMLTextAreaElement | null>(null);
  const setTextareaRef = useCallback((node: HTMLTextAreaElement | null) => {
    textareaRef.current = node;
    setTextarea(node);
  }, []);
  const { joined, peers, selfId, text } = useWeavoEditor({
    target: textarea,
    adapter: textareaAdapter,
    getTargetText: getTextareaText,
    weavoUrl,
    skipRestoreOnce,
    displayName,
    displayColor,
  });

  return (
    <div className="editor-shell">
      {peers.length > 0 ? (
        <div className="presence-bar" aria-label="People in this room">
          {peers.map((peer) => (
            <span
              key={peer.clientId}
              className={
                peer.clientId === selfId
                  ? "presence-chip presence-chip-self"
                  : "presence-chip"
              }
            >
              <span
                className="presence-dot"
                style={{ background: peer.color }}
                aria-hidden
              />
              {peer.name}
              {peer.clientId === selfId ? " (you)" : ""}
            </span>
          ))}
        </div>
      ) : null}
      <div className="editor-canvas">
        <textarea
          ref={setTextareaRef}
          className="editor-textarea"
          defaultValue=""
          placeholder={joined ? "Start typing…" : "Joining room…"}
          rows={10}
          spellCheck={false}
          aria-busy={!joined}
        />
        <RemoteCursors
          textareaRef={textareaRef}
          peers={peers.filter((peer) => peer.clientId !== selfId)}
          text={text}
        />
        {!joined ? (
          <div className="editor-joining" role="status" aria-live="polite">
            <span className="editor-joining-spinner" aria-hidden />
            Joining room…
          </div>
        ) : null}
      </div>
    </div>
  );
}
