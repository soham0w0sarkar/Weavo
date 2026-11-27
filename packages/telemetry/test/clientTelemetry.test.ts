import { describe, expect, test } from "bun:test";
import { TELEMETRY_HOOK_VERSION } from "@weavo/client";
import type { TelemetryGauges } from "@weavo/client";
import { createClientTelemetry } from "../src";
import { createGaugeGetters } from "../src/client/state";

const gaugesWith = (
  overrides: Partial<TelemetryGauges> = {},
): TelemetryGauges => ({ ...createGaugeGetters(), ...overrides });

describe("fresh collector", () => {
  test("every counter exists and is zero", () => {
    const { snapshot } = createClientTelemetry();
    const counters = Object.entries(snapshot().counters);

    expect(counters.length).toBeGreaterThan(40);
    for (const [name, value] of counters) {
      expect([name, value]).toEqual([name, 0]);
    }
  });

  test("every gauge exists and is zero", () => {
    const { snapshot } = createClientTelemetry();
    const gauges = Object.entries(snapshot().gauges);

    expect(gauges.length).toBe(17);
    for (const [name, value] of gauges) {
      expect([name, value]).toEqual([name, 0]);
    }
  });

  test("every histogram is empty, with one more slot than bounds", () => {
    const { snapshot } = createClientTelemetry();
    const histograms = Object.entries(snapshot().histograms);

    expect(histograms.map(([name]) => name).sort()).toEqual([
      "buffer.wait_ms",
      "consensus.round_ms",
      "membership.join_ms",
      "sync.catchup_ms",
    ]);
    for (const [, histogram] of histograms) {
      expect(histogram.count).toBe(0);
      expect(histogram.sum).toBe(0);
      expect(histogram.counts.length).toBe(histogram.bounds.length + 1);
      expect(histogram.counts.every((slot) => slot === 0)).toBe(true);
    }
  });

  test("two collectors do not share state", () => {
    const a = createClientTelemetry();
    const b = createClientTelemetry();
    a.hook.count("op.flushed");

    expect(a.snapshot().counters["op.flushed"]).toBe(1);
    expect(b.snapshot().counters["op.flushed"]).toBe(0);
  });

  test("the hook carries the contract version", () => {
    const { hook } = createClientTelemetry();

    expect(hook.version).toBe(TELEMETRY_HOOK_VERSION);
  });
});

describe("count()", () => {
  test("adds up hot counters and leaves the others alone", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.count("op.buffered:missing-origin");
    hook.count("op.buffered:missing-origin");
    hook.count("op.buffered:missing-target");
    hook.count("op.flushed");
    hook.count("op.flushed");
    hook.count("op.flushed");

    const { counters } = snapshot();
    expect(counters["op.buffered:missing-origin"]).toBe(2);
    expect(counters["op.buffered:missing-target"]).toBe(1);
    expect(counters["op.buffered:missing-membership"]).toBe(0);
    expect(counters["op.flushed"]).toBe(3);
    expect(counters["op.duplicate"]).toBe(0);
  });
});

describe("event()", () => {
  test("an event bumps its own counter", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.event("sync.chunk", { ops: 10 });
    hook.event("sync.chunk", { ops: 10 });
    hook.event("gc.sweep", { removed: 4, candidates: 9 });

    const { counters } = snapshot();
    expect(counters["sync.chunk"]).toBe(2);
    expect(counters["gc.sweep"]).toBe(1);
  });

  test("a labelled event bumps the counter for its label only", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.event("peer.evicted", { reason: "suspect" });
    hook.event("peer.evicted", { reason: "suspect" });
    hook.event("peer.evicted", { reason: "leave" });
    hook.event("status.change", { status: "ready" });

    const { counters } = snapshot();
    expect(counters["peer.evicted:suspect"]).toBe(2);
    expect(counters["peer.evicted:leave"]).toBe(1);
    expect(counters["peer.evicted:expired"]).toBe(0);
    expect(counters["status.change:ready"]).toBe(1);
  });

  test("an event does not bump any other counter", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.event("peer.evicted", { reason: "expired" });

    const total = Object.values(snapshot().counters).reduce(
      (sum, value) => sum + value,
      0,
    );
    expect(total).toBe(1);
  });

  test("an unknown event name is ignored", () => {
    const { hook, snapshot } = createClientTelemetry();
    const fresh = snapshot();

    const loose = hook.event as (name: string, details: object) => void;
    loose("sync.something_new", { ops: 1 });
    loose("join.start", {});
    loose("__proto__", {});

    expect(snapshot()).toEqual(fresh);
  });

  test("an unknown name in count() or record() is ignored", () => {
    const { hook, snapshot } = createClientTelemetry();
    const fresh = snapshot();

    (hook.count as (name: string) => void)("op.something_new");
    (hook.record as (name: string, value: number) => void)("nope_ms", 5);

    expect(snapshot()).toEqual(fresh);
  });
});

describe("duration buckets", () => {
  const joinSlots = (durationMs: number) => {
    const { hook, snapshot } = createClientTelemetry();
    hook.event("join.end", { outcome: "joined", durationMs });
    return snapshot().histograms["membership.join_ms"];
  };

  const slotOf = (counts: readonly number[]) =>
    counts.findIndex((n) => n === 1);

  test("the bounds are what the docs say", () => {
    const { snapshot } = createClientTelemetry();
    const { histograms } = snapshot();

    expect(histograms["membership.join_ms"].bounds).toEqual([
      1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
    ]);
    expect(histograms["buffer.wait_ms"].bounds).toEqual([
      0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1_000,
    ]);
  });

  test("a value on a bound goes in that bound's slot", () => {
    expect(slotOf(joinSlots(1).counts)).toBe(0);
    expect(slotOf(joinSlots(10).counts)).toBe(2);
    expect(slotOf(joinSlots(10_000).counts)).toBe(11);
  });

  test("a value just above a bound goes in the next slot", () => {
    expect(slotOf(joinSlots(1.01).counts)).toBe(1);
    expect(slotOf(joinSlots(11).counts)).toBe(3);
    expect(slotOf(joinSlots(5_000.5).counts)).toBe(11);
  });

  test("zero goes in the first slot", () => {
    expect(slotOf(joinSlots(0).counts)).toBe(0);
  });

  test("a value above the largest bound goes in the overflow slot", () => {
    const histogram = joinSlots(10_001);

    expect(histogram.counts.length).toBe(13);
    expect(slotOf(histogram.counts)).toBe(12);
    expect(joinSlots(1_000_000).counts[12]).toBe(1);
  });

  test("count and sum follow every sample", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.event("join.end", { outcome: "joined", durationMs: 3 });
    hook.event("join.end", { outcome: "founded", durationMs: 40 });
    hook.event("join.end", { outcome: "timeout", durationMs: 20_000 });

    const histogram = snapshot().histograms["membership.join_ms"];
    expect(histogram.count).toBe(3);
    expect(histogram.sum).toBe(20_043);
    expect(histogram.counts[1]).toBe(1);
    expect(histogram.counts[4]).toBe(1);
    expect(histogram.counts[12]).toBe(1);
    expect(histogram.counts.reduce((a, b) => a + b, 0)).toBe(3);
  });

  test("each end event lands in its own histogram", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.event("consensus.end", {
      outcome: "committed",
      durationMs: 7,
      version: 3,
      carriedForward: true,
    });
    hook.event("sync.end", { outcome: "complete", durationMs: 120 });

    const { histograms } = snapshot();
    expect(histograms["consensus.round_ms"].count).toBe(1);
    expect(histograms["sync.catchup_ms"].count).toBe(1);
    expect(histograms["membership.join_ms"].count).toBe(0);
    expect(histograms["buffer.wait_ms"].count).toBe(0);
  });

  test("record() feeds buffer.wait_ms, including its overflow slot", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.record("buffer.wait_ms", 0.5);
    hook.record("buffer.wait_ms", 0.6);
    hook.record("buffer.wait_ms", 1_000);
    hook.record("buffer.wait_ms", 1_001);

    const histogram = snapshot().histograms["buffer.wait_ms"];
    expect(histogram.counts.length).toBe(13);
    expect(histogram.counts[0]).toBe(1);
    expect(histogram.counts[1]).toBe(1);
    expect(histogram.counts[11]).toBe(1);
    expect(histogram.counts[12]).toBe(1);
    expect(histogram.count).toBe(4);
  });

  test("negative, non-finite and missing durations record nothing", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.event("join.end", { outcome: "failed", durationMs: -1 });
    hook.event("join.end", { outcome: "failed", durationMs: Number.NaN });
    hook.event("join.end", {
      outcome: "failed",
      durationMs: Number.POSITIVE_INFINITY,
    });
    hook.record("buffer.wait_ms", -5);

    const { histograms, counters } = snapshot();
    expect(histograms["membership.join_ms"].count).toBe(0);
    expect(histograms["membership.join_ms"].sum).toBe(0);
    expect(histograms["buffer.wait_ms"].count).toBe(0);
    expect(counters["join.end:failed"]).toBe(3);
  });
});

describe("gauges", () => {
  test("are read when the snapshot is taken, not when attached", () => {
    const { hook, snapshot } = createClientTelemetry();
    let nodes = 1;
    let calls = 0;
    hook.attach(
      gaugesWith({
        "doc.nodes": () => {
          calls++;
          return nodes;
        },
      }),
    );

    expect(calls).toBe(0);
    expect(snapshot().gauges["doc.nodes"]).toBe(1);
    nodes = 250;
    expect(snapshot().gauges["doc.nodes"]).toBe(250);
    expect(calls).toBe(2);
  });

  test("a getter that throws or returns junk reads as zero", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.attach(
      gaugesWith({
        "doc.nodes": () => {
          throw new Error("replica is gone");
        },
        "buffer.depth": () => Number.NaN,
        "membership.peers": () => 3,
      }),
    );

    const { gauges } = snapshot();
    expect(gauges["doc.nodes"]).toBe(0);
    expect(gauges["buffer.depth"]).toBe(0);
    expect(gauges["membership.peers"]).toBe(3);
  });

  test("a gauge the client did not supply stays at zero", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.attach({ "doc.nodes": () => 7 });

    const { gauges } = snapshot();
    expect(gauges["doc.nodes"]).toBe(7);
    expect(gauges["doc.tombstones"]).toBe(0);
  });

  test("a gauge name this collector does not know is ignored", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.attach({
      ...gaugesWith(),
      "doc.something_new": () => 9,
    } as unknown as TelemetryGauges);

    expect("doc.something_new" in snapshot().gauges).toBe(false);
  });
});

describe("snapshot", () => {
  test("is a copy: editing it does not touch the collector", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.count("op.flushed");

    const first = snapshot();
    first.counters["op.flushed"] = 999;
    (first.histograms["buffer.wait_ms"].counts as number[])[0] = 999;

    const second = snapshot();
    expect(second.counters["op.flushed"]).toBe(1);
    expect(second.histograms["buffer.wait_ms"].counts[0]).toBe(0);
  });

  test("does not change when later events arrive", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.record("buffer.wait_ms", 2);
    const before = snapshot();

    hook.count("op.flushed");
    hook.record("buffer.wait_ms", 2);

    expect(before.counters["op.flushed"]).toBe(0);
    expect(before.histograms["buffer.wait_ms"].count).toBe(1);
    expect(snapshot().histograms["buffer.wait_ms"].count).toBe(2);
  });
});
