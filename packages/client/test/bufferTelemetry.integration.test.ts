import "./setup";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { generateClientId } from "@weavo/core";
import {
  TELEMETRY_HOOK_VERSION,
  type TelemetryGauges,
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

const settle = async (ms = 250) => {
  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const recorder = (version: number = TELEMETRY_HOOK_VERSION) => {
  const counts = new Map<string, number>();
  const waits: number[] = [];
  let gauges: Partial<TelemetryGauges> = {};
  const hook: WeavoTelemetryHook = {
    version,
    count: (name) => counts.set(name, (counts.get(name) ?? 0) + 1),
    event: () => {},
    record: (name, value) => {
      if (name === "buffer.wait_ms") waits.push(value);
    },
    attach: (next) => {
      gauges = next;
    },
  };
  return {
    hook,
    waits,
    count: (name: string) => counts.get(name) ?? 0,
    gauge: (name: keyof TelemetryGauges) => gauges[name]?.(),
  };
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

const pair = async (observed?: WeavoTelemetryHook) => {
  const room = new MemoryRoom();
  const members = [generateClientId(), generateClientId()];
  const a = await createPeer(room, {
    clientId: members[0]!,
    members,
    ...(observed ? { telemetry: observed } : {}),
  });
  const b = await createPeer(room, { clientId: members[1]!, members });
  cleanup = [a, b];
  return { a, b };
};

describe("buffer telemetry", () => {
  test("a missed op moves the buffer numbers, then they settle", async () => {
    const spy = recorder();
    const { a, b } = await pair(spy.hook);

    expect(spy.gauge("buffer.depth")).toBe(0);
    expect(spy.gauge("doc.nodes")).toBe(1);

    a.raw.setDeaf(true);
    typeAtEnd(b, "a");
    a.raw.setDeaf(false);
    typeAtEnd(b, "b");
    await flushMicrotasks();

    expect(a.el.value).toBe("");
    expect(spy.count("op.buffered:missing-origin")).toBe(1);
    expect(spy.count("op.flushed")).toBe(0);
    expect(spy.gauge("buffer.depth")).toBe(1);

    await settle();

    expect(a.el.value).toBe("ab");
    expect(spy.count("op.buffered:missing-origin")).toBe(1);
    expect(spy.count("op.buffered:missing-target")).toBe(0);
    expect(spy.count("op.buffered:missing-membership")).toBe(0);
    expect(spy.count("op.flushed")).toBe(1);
    expect(spy.count("op.duplicate")).toBe(1);
    expect(spy.waits).toHaveLength(1);
    expect(spy.waits[0]!).toBeGreaterThan(0);
    expect(spy.gauge("buffer.depth")).toBe(0);
    expect(spy.gauge("doc.nodes")).toBe(3);
  });

  test("an op that arrives a second time counts as a duplicate", async () => {
    const spy = recorder();
    const { a, b } = await pair(spy.hook);
    const frames: Uint8Array[] = [];
    const send = b.raw.send.bind(b.raw);
    b.raw.send = (data) => {
      frames.push(data);
      send(data);
    };

    typeAtEnd(b, "x");
    await settle(50);
    expect(a.el.value).toBe("x");
    expect(spy.count("op.duplicate")).toBe(0);

    send(frames.at(-1)!);
    await settle(50);

    expect(spy.count("op.duplicate")).toBe(1);
    expect(spy.count("op.buffered:missing-origin")).toBe(0);
    expect(spy.count("op.flushed")).toBe(0);
    expect(a.el.value).toBe("x");
  });

  test("plain typing with no gaps leaves every buffer number at zero", async () => {
    const spy = recorder();
    const { a, b } = await pair(spy.hook);

    typeAtEnd(b, "hello");
    await settle(50);

    expect(a.el.value).toBe("hello");
    expect(spy.count("op.buffered:missing-origin")).toBe(0);
    expect(spy.count("op.flushed")).toBe(0);
    expect(spy.count("op.duplicate")).toBe(0);
    expect(spy.gauge("doc.nodes")).toBe(6);
  });

  test("a hook with a different version is never used", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const spy = recorder(TELEMETRY_HOOK_VERSION + 1);
    const { a, b } = await pair(spy.hook);

    a.raw.setDeaf(true);
    typeAtEnd(b, "a");
    a.raw.setDeaf(false);
    typeAtEnd(b, "b");
    await settle();

    expect(a.el.value).toBe("ab");
    expect(spy.count("op.buffered:missing-origin")).toBe(0);
    expect(spy.gauge("buffer.depth")).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
