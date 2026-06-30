"use client";

import { useEffect, useRef } from "react";
import { createRelay } from "@relay/client";

export function RelayTextarea({
  label,
  relayUrl,
}: {
  label: string;
  relayUrl: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const relay = createRelay(relayUrl);
    const unbind = relay.bind(el);

    return () => {
      unbind();
      relay.disconnect();
    };
  }, [relayUrl]);

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
}
