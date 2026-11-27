import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { generateClientId } from "@weavo/core";
import {
  TELEMETRY_HOOK_VERSION,
  type TelemetryEventDetails,
  type TelemetryEventName,
  type WeavoTelemetryHook,
} from "../src";
import {
  createPeer,
  flushMicrotasks,
  insertText,
  moveCursor,
  teardownPeers,
  type Peer,
} from "./helpers/editor";
import { MemoryRoom } from "./helpers/memoryTransport";

type Seen = {
  [K in TelemetryEventName]?: TelemetryEventDetails[K][];
};

const recorder = () => {
  const seen: Seen = {};
  const hook: WeavoTelemetryHook = {
    version: TELEMETRY_HOOK_VERSION,
    count: () => {},
    event: (name, details) => {
      const list = (seen[name] ??= []) as unknown[];
      list.push(details);
    },
    record: () => {},
    attach: () => {},
  };
  return { hook, seen };
};

const settle = async (ms = 300) => {
  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const typeAtEnd = (peer: Peer, text: string) => {
  moveCursor(peer.el, peer.el.value.length);
  insertText(peer.el, text);
};

let cleanup: Peer[] = [];
afterEach(() => {
  teardownPeers(...cleanup);
  cleanup = [];
});

describe("sync telemetry", () => {
  test("catching up reports a request, a response, and a completed sync", async () => {
    const room = new MemoryRoom();
    const members = [generateClientId(), generateClientId()];
    const a = recorder();
    const b = recorder();
    const peerA = await createPeer(room, {
      clientId: members[0]!,
      members,
      telemetry: a.hook,
    });
    const peerB = await createPeer(room, {
      clientId: members[1]!,
      members,
      telemetry: b.hook,
    });
    cleanup = [peerA, peerB];
    await settle(100);

    peerA.raw.goOffline();
    typeAtEnd(peerB, "abc");
    const requestsBefore = a.seen["sync.request_sent"]?.length ?? 0;
    peerA.raw.goOnline();
    await settle();

    expect(peerA.el.value).toBe("abc");
    expect((a.seen["sync.request_sent"]?.length ?? 0) - requestsBefore).toBe(1);
    expect(b.seen["sync.response_sent"]).toEqual([{ ops: 3, recipients: 1 }]);

    const ends = a.seen["sync.end"] ?? [];
    expect(ends).toHaveLength(1);
    expect(ends[0]!.outcome).toBe("complete");
    expect(ends[0]!.durationMs).toBeGreaterThan(0);
    expect(ends[0]!.durationMs).toBeLessThan(2_000);
    expect(b.seen["sync.end"]).toBeUndefined();
  });

  test("a sync with nothing to fetch ends nothing", async () => {
    const room = new MemoryRoom();
    const members = [generateClientId(), generateClientId()];
    const a = recorder();
    const peerA = await createPeer(room, {
      clientId: members[0]!,
      members,
      telemetry: a.hook,
    });
    const peerB = await createPeer(room, { clientId: members[1]!, members });
    cleanup = [peerA, peerB];

    peerA.raw.goOffline();
    peerA.raw.goOnline();
    await settle();

    expect(a.seen["sync.request_sent"]?.length).toBeGreaterThanOrEqual(1);
    expect(a.seen["sync.end"]).toBeUndefined();
  });

  test("an unanswered request does not inflate a later sync", async () => {
    const room = new MemoryRoom();
    const members = [generateClientId(), generateClientId()];
    const a = recorder();
    const peerA = await createPeer(room, {
      clientId: members[0]!,
      members,
      telemetry: a.hook,
    });
    const peerB = await createPeer(room, { clientId: members[1]!, members });
    cleanup = [peerA, peerB];

    // The first request finds nothing missing, so it is never answered.
    await settle(700);
    expect(a.seen["sync.request_sent"]?.length).toBeGreaterThanOrEqual(1);
    expect(a.seen["sync.end"]).toBeUndefined();

    // No disconnect: a missed op makes the client ask again on its own.
    peerA.raw.setDeaf(true);
    typeAtEnd(peerB, "a");
    peerA.raw.setDeaf(false);
    typeAtEnd(peerB, "b");
    await settle();

    const ends = a.seen["sync.end"] ?? [];
    expect(peerA.el.value).toBe("ab");
    expect(ends).toHaveLength(1);
    expect(ends[0]!.durationMs).toBeGreaterThan(0);
    expect(ends[0]!.durationMs).toBeLessThan(300);
  });

  test("a response that covers other waiting peers suppresses their reply", async () => {
    const room = new MemoryRoom();
    const members = [
      generateClientId(),
      generateClientId(),
      generateClientId(),
    ];
    const a = recorder();
    const b = recorder();
    const c = recorder();
    const peerA = await createPeer(room, {
      clientId: members[0]!,
      members,
      telemetry: a.hook,
    });
    const peerB = await createPeer(room, {
      clientId: members[1]!,
      members,
      telemetry: b.hook,
    });
    const peerC = await createPeer(room, {
      clientId: members[2]!,
      members,
      telemetry: c.hook,
    });
    cleanup = [peerA, peerB, peerC];
    await settle(100);

    peerA.raw.goOffline();
    typeAtEnd(peerB, "abc");
    await settle(50);
    expect(peerC.el.value).toBe("abc");
    peerA.raw.goOnline();
    await settle();

    const sent =
      (b.seen["sync.response_sent"]?.length ?? 0) +
      (c.seen["sync.response_sent"]?.length ?? 0);
    const suppressed =
      (b.seen["sync.suppressed"]?.length ?? 0) +
      (c.seen["sync.suppressed"]?.length ?? 0);

    expect(peerA.el.value).toBe("abc");
    expect(sent).toBe(1);
    expect(suppressed).toBe(1);
    const [event] = [
      ...(b.seen["sync.suppressed"] ?? []),
      ...(c.seen["sync.suppressed"] ?? []),
    ];
    expect(event).toEqual({ coveredOps: 3 });
    expect(a.seen["sync.end"]).toHaveLength(1);
  });
});
