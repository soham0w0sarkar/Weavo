import "./setup";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { generateClientId } from "@weavo/core";
import { MEM_HEARTBEAT, MSG_MEMBERSHIP } from "@weavo/transport";
import {
  createPeer,
  flushMicrotasks,
  insertText,
  moveCursor,
  teardownPeers,
  type Peer,
} from "./helpers/editor";
import { MemoryRoom } from "./helpers/memoryTransport";

const settle = async (ms = 150) => {
  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const room = () => {
  const memory = new MemoryRoom();
  const members = Array.from({ length: 4 }, () => generateClientId());
  const peer = (index: number, heartbeatIntervalMs = 0) =>
    createPeer(memory, {
      clientId: members[index]!,
      members,
      heartbeatIntervalMs,
    });
  return { memory, members, peer };
};

const typeAtEnd = (peer: Peer, text: string) => {
  moveCursor(peer.el, peer.el.value.length);
  insertText(peer.el, text);
};

const reconnect = async (peer: Peer) => {
  peer.raw.goOnline();
  await settle();
};

let cleanup: Peer[] = [];
afterEach(() => {
  teardownPeers(...cleanup);
  cleanup = [];
});

describe("sync on every open after join", () => {
  test("a returning peer receives ops made while it was offline", async () => {
    const { peer } = room();
    const a = await peer(0);
    const b = await peer(1);
    cleanup = [a, b];

    b.raw.goOffline();
    typeAtEnd(a, "abc");
    await settle(20);
    expect(b.el.value).toBe("");

    await reconnect(b);
    expect(b.el.value).toBe("abc");
  });

  test("a returning peer pushes ops it made while offline", async () => {
    const { peer } = room();
    const a = await peer(0);
    const b = await peer(1);
    cleanup = [a, b];

    b.raw.goOffline();
    typeAtEnd(b, "xyz");
    await settle(20);
    expect(a.el.value).toBe("");

    await reconnect(b);
    expect(a.el.value).toBe("xyz");
    expect(b.el.value).toBe("xyz");
  });

  test("two peers that both edited offline converge after reconnecting", async () => {
    const { peer } = room();
    const a = await peer(0);
    const b = await peer(1);
    cleanup = [a, b];

    typeAtEnd(a, "shared ");
    await settle(20);
    expect(b.el.value).toBe("shared ");

    a.raw.goOffline();
    b.raw.goOffline();
    for (let round = 0; round < 20; round++) {
      typeAtEnd(a, "a");
      typeAtEnd(b, "b");
    }
    await settle(20);

    await reconnect(a);
    await reconnect(b);
    expect(a.el.value).toBe(b.el.value);
    expect(a.el.value.length).toBe("shared ".length + 40);
  });
});

describe("responders keep answering", () => {
  test("a peer that had nothing to send still answers a later joiner", async () => {
    const { peer } = room();
    const a = await peer(0);
    const b = await peer(1);
    await settle(20);

    teardownPeers(b);
    typeAtEnd(a, "later");
    await settle(20);

    const c = await peer(2);
    cleanup = [a, c];
    await settle();
    expect(c.el.value).toBe("later");
  });

  test("the losing responder still answers the next request", async () => {
    const random = spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const { peer } = room();
      const a = await peer(0);
      typeAtEnd(a, "text");
      const b = await peer(1);
      await settle();
      expect(b.el.value).toBe("text");

      // a and b both hold "text"; with equal backoff a answers c and b loses.
      const c = await peer(2);
      await settle();
      expect(c.el.value).toBe("text");

      teardownPeers(a, c);
      const d = await peer(3);
      cleanup = [b, d];
      await settle();
      expect(d.el.value).toBe("text");
    } finally {
      random.mockRestore();
    }
  });
});

describe("sync on wake-up", () => {
  const missWhileOpen = async (a: Peer, b: Peer) => {
    b.raw.setDeaf(true);
    typeAtEnd(a, "missed");
    await settle(20);
    b.raw.setDeaf(false);
    expect(b.el.value).toBe("");
  };

  test("a visible tab asks peers for anything it missed", async () => {
    const { peer } = room();
    const a = await peer(0);
    const b = await peer(1);
    cleanup = [a, b];
    await missWhileOpen(a, b);

    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(b.el.value).toBe("missed");
  });

  test("the online event asks peers for anything it missed", async () => {
    const { peer } = room();
    const a = await peer(0);
    const b = await peer(1);
    cleanup = [a, b];
    await missWhileOpen(a, b);

    window.dispatchEvent(new Event("online"));
    await settle();
    expect(b.el.value).toBe("missed");
  });
});

describe("heartbeats follow the socket", () => {
  const heartbeats = (frames: Uint8Array[]) =>
    frames.filter(
      (frame) => frame[1] === MSG_MEMBERSHIP && frame[2] === MEM_HEARTBEAT,
    ).length;

  test("no heartbeats are sent or queued while the socket is down", async () => {
    const { peer } = room();
    const a = await peer(0, 10);
    const b = await peer(1, 10);
    cleanup = [a, b];

    b.raw.goOffline();
    await settle(100);
    expect(heartbeats(b.raw.offlineSends)).toBe(0);

    const before = b.raw.offlineSends.length;
    await reconnect(b);
    expect(b.raw.offlineSends.length).toBe(before);
  });
});
