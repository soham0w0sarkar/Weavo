import { describe, expect, spyOn, test } from "bun:test";
import {
  createTelemetry,
  TELEMETRY_HOOK_VERSION,
  type WeavoTelemetryHook,
} from "../src/telemetry";

const makeHook = (overrides: Partial<WeavoTelemetryHook> = {}) => {
  const calls: string[] = [];
  const hook: WeavoTelemetryHook = {
    version: TELEMETRY_HOOK_VERSION,
    count: (name) => void calls.push(`count:${name}`),
    event: (name) => void calls.push(`event:${name}`),
    record: (name, value) => void calls.push(`record:${name}:${value}`),
    attach: () => void calls.push("attach"),
    ...overrides,
  };
  return { hook, calls };
};

describe("createTelemetry", () => {
  test("without a hook every call is a no-op", () => {
    for (const telemetry of [createTelemetry(), createTelemetry(null)]) {
      expect(telemetry.version).toBe(0);
      expect(() => {
        telemetry.count("op.duplicate");
        telemetry.event("sync.claim", {});
        telemetry.record("buffer.wait_ms", 3);
        telemetry.attach({} as never);
      }).not.toThrow();
    }
  });

  test("forwards calls to the hook and keeps its version", () => {
    const { hook, calls } = makeHook();
    const telemetry = createTelemetry(hook);

    telemetry.count("op.flushed");
    telemetry.event("sync.end", { outcome: "complete", durationMs: 12 });
    telemetry.record("buffer.wait_ms", 2.5);
    telemetry.attach({} as never);

    expect(telemetry.version).toBe(TELEMETRY_HOOK_VERSION);
    expect(calls).toEqual([
      "count:op.flushed",
      "event:sync.end",
      "record:buffer.wait_ms:2.5",
      "attach",
    ]);
  });

  test("swallows errors thrown by the hook", () => {
    const { hook } = makeHook({
      count: () => {
        throw new Error("boom");
      },
    });
    const telemetry = createTelemetry(hook);

    expect(() => telemetry.count("op.duplicate")).not.toThrow();
  });

  test("switches to the no-op for good after three failures", () => {
    let attempts = 0;
    const { hook, calls } = makeHook({
      count: () => {
        attempts++;
        throw new Error("boom");
      },
    });
    const telemetry = createTelemetry(hook);

    for (let i = 0; i < 10; i++) telemetry.count("op.duplicate");
    telemetry.event("sync.claim", {});
    telemetry.record("buffer.wait_ms", 1);

    expect(attempts).toBe(3);
    expect(calls).toEqual([]);
  });

  test("failures from different calls add up", () => {
    const boom = () => {
      throw new Error("boom");
    };
    const { hook, calls } = makeHook({
      count: boom,
      event: boom,
      record: boom,
    });
    const telemetry = createTelemetry(hook);

    telemetry.count("op.duplicate");
    telemetry.event("sync.claim", {});
    telemetry.record("buffer.wait_ms", 1);
    telemetry.attach({} as never);

    expect(calls).toEqual([]);
  });

  test("a hook with a different version is not attached", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const { hook, calls } = makeHook({ version: TELEMETRY_HOOK_VERSION + 1 });
    const telemetry = createTelemetry(hook);

    telemetry.count("op.duplicate");
    telemetry.event("sync.claim", {});
    telemetry.record("buffer.wait_ms", 1);
    telemetry.attach({} as never);

    expect(calls).toEqual([]);
    expect(telemetry.version).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
