"use client";

import { useEffect, useRef } from "react";
import { createRelay } from "@repo/relay";

const WS_URL =
  process.env.NEXT_PUBLIC_RELAY_WS_URL ?? "ws://localhost:8080?room=demo";

export function RelayTextarea({ label }: { label: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const relay = createRelay(WS_URL);
    const unbind = relay.bind(el);

    return () => {
      unbind();
      relay.disconnect();
    };
  }, []);

  return (
    <label className="editor">
      <span className="editor-label">{label}</span>
      <textarea
        ref={textareaRef}
        className="editor-textarea"
        defaultValue=""
        placeholder="Type here — changes sync to the other box"
        rows={8}
      />
    </label>
  );
};
