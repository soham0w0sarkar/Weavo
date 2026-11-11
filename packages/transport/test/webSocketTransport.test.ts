import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createWebSocketTransport } from "../src";

type Listener = (event: { data?: unknown }) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly sent: unknown[] = [];
  binaryType = "blob";
  readyState = FakeWebSocket.CONNECTING;

  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }

  receive(data: unknown) {
    this.emit("message", { data });
  }

  serverClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  private emit(type: string, event: { data?: unknown }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

type Timer = {
  id: number;
  callback: () => void;
  delay: number;
  cleared: boolean;
};

let timers: Timer[] = [];
let nextTimerId = 1;

const originalWebSocket = globalThis.WebSocket;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const originalDocument = (globalThis as { document?: unknown }).document;

const activeTimer = () => timers.find((timer) => !timer.cleared);

const runTimer = () => {
  const timer = activeTimer();
  if (!timer) throw new Error("no scheduled timer");
  timer.cleared = true;
  timer.callback();
};

const latestSocket = () => FakeWebSocket.instances.at(-1)!;

const bytes = (...values: number[]) => new Uint8Array(values);

beforeEach(() => {
  FakeWebSocket.instances = [];
  timers = [];
  nextTimerId = 1;

  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  (globalThis as { setTimeout?: unknown }).setTimeout = (
    callback: () => void,
    delay = 0,
  ) => {
    const id = nextTimerId++;
    timers.push({ id, callback, delay, cleared: false });
    return id;
  };
  (globalThis as { clearTimeout?: unknown }).clearTimeout = (id: number) => {
    const timer = timers.find((candidate) => candidate.id === id);
    if (timer) timer.cleared = true;
  };
});

afterEach(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
  (globalThis as { setTimeout?: unknown }).setTimeout = originalSetTimeout;
  (globalThis as { clearTimeout?: unknown }).clearTimeout =
    originalClearTimeout;
  if (originalDocument === undefined) {
    delete (globalThis as { document?: unknown }).document;
  } else {
    (globalThis as { document?: unknown }).document = originalDocument;
  }
});

describe("createWebSocketTransport", () => {
  test("queues sends until the socket opens, then flushes in order", () => {
    const transport = createWebSocketTransport("ws://test", {
      reconnect: false,
    });
    transport.connect();

    const socket = latestSocket();
    transport.send(bytes(1));
    transport.send(bytes(2));

    expect(socket.sent).toEqual([]);

    socket.open();

    expect(socket.sent).toEqual([bytes(1), bytes(2)]);
    transport.disconnect();
  });

  test("reconnects after a server close and delivers queued sends", () => {
    const transport = createWebSocketTransport("ws://test", {
      reconnect: true,
      reconnectMinDelay: 10,
      reconnectMaxDelay: 40,
    });
    transport.connect();

    const first = latestSocket();
    first.open();
    transport.send(bytes(1));
    expect(first.sent).toEqual([bytes(1)]);

    first.serverClose();

    expect(activeTimer()?.delay).toBe(10);
    expect(FakeWebSocket.instances).toHaveLength(1);

    transport.send(bytes(2));
    expect(FakeWebSocket.instances).toHaveLength(1);

    runTimer();

    const second = latestSocket();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(second.readyState).toBe(FakeWebSocket.CONNECTING);

    transport.send(bytes(3));
    second.open();

    expect(second.sent).toEqual([bytes(2), bytes(3)]);
    transport.disconnect();
  });

  test("backs off exponentially and caps the delay", () => {
    const transport = createWebSocketTransport("ws://test", {
      reconnect: true,
      reconnectMinDelay: 10,
      reconnectMaxDelay: 40,
    });
    transport.connect();
    latestSocket().open();

    for (const delay of [10, 20, 40, 40]) {
      latestSocket().serverClose();
      expect(activeTimer()?.delay).toBe(delay);
      runTimer();
    }

    transport.disconnect();
  });

  test("reset backoff after a successful open", () => {
    const transport = createWebSocketTransport("ws://test", {
      reconnect: true,
      reconnectMinDelay: 10,
      reconnectMaxDelay: 40,
    });
    transport.connect();
    latestSocket().open();

    latestSocket().serverClose();
    expect(activeTimer()?.delay).toBe(10);
    runTimer();
    latestSocket().open();

    latestSocket().serverClose();
    expect(activeTimer()?.delay).toBe(10);

    transport.disconnect();
  });

  test("does not reconnect when reconnect is disabled", () => {
    const transport = createWebSocketTransport("ws://test", {
      reconnect: false,
    });
    transport.connect();
    latestSocket().open();

    latestSocket().serverClose();

    expect(activeTimer()).toBeUndefined();
    expect(FakeWebSocket.instances).toHaveLength(1);
    transport.disconnect();
  });

  test("disconnect cancels the reconnect timer and clears queued sends", () => {
    const transport = createWebSocketTransport("ws://test", {
      reconnect: true,
      reconnectMinDelay: 10,
      reconnectMaxDelay: 40,
    });
    transport.connect();
    latestSocket().open();

    latestSocket().serverClose();
    transport.send(bytes(1));

    expect(activeTimer()).toBeDefined();

    transport.disconnect();

    expect(activeTimer()).toBeUndefined();
    expect(() => transport.send(bytes(2))).toThrow("Transport not connected");
    expect(FakeWebSocket.instances).toHaveLength(1);

    transport.connect();
    latestSocket().open();

    expect(latestSocket().sent).toEqual([]);
    transport.disconnect();
  });

  test("forwards messages and close events to subscribers", () => {
    const transport = createWebSocketTransport("ws://test", {
      reconnect: false,
    });
    const messages: Uint8Array[] = [];
    let closes = 0;

    transport.onMessage((data) => messages.push(data));
    transport.onClose(() => {
      closes++;
    });

    transport.connect();
    const socket = latestSocket();
    socket.open();

    socket.receive(bytes(7, 8));
    expect(messages).toEqual([bytes(7, 8)]);

    socket.serverClose();
    expect(closes).toBe(1);

    transport.disconnect();
  });

  test("reconnects immediately when the document becomes visible", () => {
    const visibilityListeners = new Set<() => void>();
    const fakeDocument = {
      visibilityState: "hidden",
      addEventListener(type: string, listener: () => void) {
        if (type === "visibilitychange") visibilityListeners.add(listener);
      },
    };
    (globalThis as { document?: unknown }).document = fakeDocument;

    const transport = createWebSocketTransport("ws://test", {
      reconnect: true,
      reconnectMinDelay: 1_000,
      reconnectMaxDelay: 30_000,
    });
    transport.connect();
    latestSocket().open();

    latestSocket().serverClose();
    expect(activeTimer()?.delay).toBe(1_000);

    fakeDocument.visibilityState = "visible";
    for (const listener of visibilityListeners) listener();

    expect(activeTimer()).toBeUndefined();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(latestSocket().readyState).toBe(FakeWebSocket.CONNECTING);

    transport.disconnect();
  });
});
