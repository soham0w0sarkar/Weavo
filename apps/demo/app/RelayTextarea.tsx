"use client";

import { useEffect, useRef } from "react";
import { createRelay } from "@relay/client";

export function RelayTextarea({ relayUrl }: { relayUrl: string }) {
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
