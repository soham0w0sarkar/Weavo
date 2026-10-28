"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  createWeavo,
  type PeerPresence,
  type Weavo,
  type WeavoAdapter,
} from "@weavo/client";
import {
  appendClientDelta,
  getOrCreateClientId,
  hasClientSnapshot,
  loadClientStorage,
  saveClientSnapshot,
} from "./lib/clientStorage";

const CHECKPOINT_EVERY_OPS = 50;
const HEARTBEAT_MS = 750;
const PRESENCE_TIMEOUT_MS = 8_000;
const REMOVAL_TIMEOUT_MS = 20_000;

const roomIdFromUrl = (weavoUrl: string) =>
  new URL(weavoUrl).searchParams.get("room") ?? "";

export type WeavoEditorState<TTarget> = {
  joined: boolean;
  peers: PeerPresence[];
  selfId: string;
  text: string;
  weavoRef: RefObject<Weavo<TTarget> | null>;
};

export const useWeavoEditor = <TTarget>({
  target,
  adapter,
  getTargetText,
  weavoUrl,
  skipRestoreOnce = false,
  displayName,
  displayColor,
}: {
  target: TTarget | null;
  adapter: WeavoAdapter<TTarget>;
  getTargetText: (target: TTarget) => string;
  weavoUrl: string;
  skipRestoreOnce?: boolean;
  displayName: string;
  displayColor: string;
}): WeavoEditorState<TTarget> => {
  const skipRestore = useRef(skipRestoreOnce);
  const weavoRef = useRef<Weavo<TTarget> | null>(null);
  const [joined, setJoined] = useState(false);
  const [peers, setPeers] = useState<PeerPresence[]>([]);
  const [selfId, setSelfId] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    if (skipRestoreOnce) skipRestore.current = true;
  }, [skipRestoreOnce]);

  useEffect(() => {
    weavoRef.current?.setIdentity({
      name: displayName,
      color: displayColor,
    });
  }, [displayName, displayColor]);

  useEffect(() => {
    if (!target) return;

    setJoined(false);
    setPeers([]);
    setText("");

    const roomId = roomIdFromUrl(weavoUrl);
    const clientId = getOrCreateClientId();
    setSelfId(clientId);
    const doRestore = !skipRestore.current;
    skipRestore.current = false;
    const stored = doRestore ? loadClientStorage(roomId, clientId) : null;
    let opsSinceCheckpoint = 0;
    let closed = false;

    const weavo = createWeavo(weavoUrl, {
      adapter,
      clientId,
      name: displayName,
      color: displayColor,
      heartbeatIntervalMs: HEARTBEAT_MS,
      presenceTimeoutMs: PRESENCE_TIMEOUT_MS,
      removalTimeoutMs: REMOVAL_TIMEOUT_MS,
      initial: stored?.snapshot
        ? { snapshot: stored.snapshot, delta: stored.delta }
        : undefined,
      onOp(op) {
        appendClientDelta(roomId, clientId, op);
        opsSinceCheckpoint++;
        if (
          opsSinceCheckpoint >= CHECKPOINT_EVERY_OPS ||
          !hasClientSnapshot(roomId, clientId)
        ) {
          saveClientSnapshot(roomId, clientId, weavo.snapshot());
          opsSinceCheckpoint = 0;
        }
      },
    });
    weavoRef.current = weavo;

    const checkpoint = () => {
      if (!roomId || closed) return;
      saveClientSnapshot(roomId, clientId, weavo.snapshot());
      opsSinceCheckpoint = 0;
    };

    const teardown = () => {
      if (closed) return;
      checkpoint();
      closed = true;
      weavoRef.current = null;
      weavo.disconnect();
    };

    const unsubJoined = weavo.membership.onJoined(() => setJoined(true));
    if (weavo.membership.isJoined()) setJoined(true);
    const unsubPresence = weavo.onPresence((all) =>
      setPeers([...all.values()]),
    );
    const unbind = weavo.bind(target);
    const syncText = () => setText(getTargetText(target));
    const unsubText = weavo.textSubscribe(syncText);
    syncText();

    window.addEventListener("pagehide", teardown);

    return () => {
      window.removeEventListener("pagehide", teardown);
      unsubJoined();
      unsubPresence();
      unsubText();
      unbind();
      teardown();
    };
    // Identity updates go through setIdentity without reconnecting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, getTargetText, target, weavoUrl]);

  return { joined, peers, selfId, text, weavoRef };
};
