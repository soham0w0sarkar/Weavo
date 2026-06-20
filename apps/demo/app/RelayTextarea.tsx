"use client";

import { useEffect, useRef, useState } from "react";
import { createRelay, type TextChange } from "@repo/relay";

const WS_URL =
  process.env.NEXT_PUBLIC_RELAY_WS_URL ?? "ws://localhost:8080?room=demo";

const applyChange = (value: string, change: TextChange) => {
  if (change.insert) {
    return (
      value.slice(0, change.index) +
      change.insert +
      value.slice(change.index)
    );
  }

  if (change.delete) {
    return (
      value.slice(0, change.index) +
      value.slice(change.index + change.delete)
    );
  }

  return value;
};

export function RelayTextarea({ label }: { label: string }) {
  const relayRef = useRef<ReturnType<typeof createRelay> | null>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    const relay = createRelay(WS_URL);
    relayRef.current = relay;

    const unsubscribe = relay.textSubscribe((change) => {
      setValue((prev) => applyChange(prev, change));
    });

    return () => {
      unsubscribe();
      relay.disconnect();
    };
  }, []);

  return (
    <label className="editor">
      <span className="editor-label">{label}</span>
      <textarea
        className="editor-textarea"
        value={value}
        onBeforeInput={(event) => {
          relayRef.current?.onBeforeInput(
            event.nativeEvent as InputEvent,
          );
        }}
        onInput={(event) => {
          relayRef.current?.onInput(event.nativeEvent as InputEvent);
        }}
        placeholder="Type here — changes sync to the other box"
        rows={8}
      />
    </label>
  );
}
