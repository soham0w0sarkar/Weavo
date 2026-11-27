import { describe, expect, test } from "bun:test";
import { HISTOGRAM_BOUNDS } from "../src/client/bounds";
import {
  bumpCounter,
  createCounters,
  createHistogramState,
  recordHistogram,
  recordSample,
  snapshotHistogram,
} from "../src/client/state";
import type { HistogramName, HistogramState } from "../src/client/types";

const createHistograms = (): Record<HistogramName, HistogramState> => ({
  "membership.join_ms": createHistogramState("membership.join_ms"),
  "consensus.round_ms": createHistogramState("consensus.round_ms"),
  "sync.catchup_ms": createHistogramState("sync.catchup_ms"),
  "buffer.wait_ms": createHistogramState("buffer.wait_ms"),
});

describe("counters", () => {
  test("every counter starts at zero", () => {
    const counters = createCounters();
    const values = Object.values(counters);

    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => value === 0)).toBe(true);
  });

  test("bumps a known counter", () => {
    const counters = createCounters();
    bumpCounter(counters, "op.duplicate");
    bumpCounter(counters, "join.end:timeout");

    expect(counters["op.duplicate"]).toBe(1);
    expect(counters["join.end:timeout"]).toBe(1);
  });

  test("ignores a name it does not know", () => {
    const counters = createCounters();
    const before = Object.keys(counters).length;

    bumpCounter(counters, "op.something_new");
    bumpCounter(counters, "join.end:exploded");
    bumpCounter(counters, "__proto__");
    bumpCounter(counters, "toString");

    expect(Object.keys(counters).length).toBe(before);
    expect(Object.values(counters).every((value) => value === 0)).toBe(true);
  });
});

describe("histograms", () => {
  test("counts has one more slot than bounds", () => {
    for (const name of Object.keys(HISTOGRAM_BOUNDS) as HistogramName[]) {
      expect(createHistogramState(name).counts.length).toBe(
        HISTOGRAM_BOUNDS[name].length + 1,
      );
    }
  });

  test("values land in the first bucket they do not exceed", () => {
    const state = createHistogramState("buffer.wait_ms");
    for (const value of [0.3, 0.5, 0.6, 3, 3.5]) {
      recordHistogram("buffer.wait_ms", state, value);
    }

    const { counts } = snapshotHistogram("buffer.wait_ms", state);
    expect(counts.slice(0, 4)).toEqual([2, 1, 0, 2]);
    expect(counts.slice(4).every((count) => count === 0)).toBe(true);
  });

  test("values above the largest bound go in the extra slot", () => {
    const state = createHistogramState("buffer.wait_ms");
    recordHistogram("buffer.wait_ms", state, 5_000);
    recordHistogram("buffer.wait_ms", state, 1e9);

    expect(state.counts.at(-1)).toBe(2);
    expect(state.count).toBe(2);
  });

  test("counts are not cumulative", () => {
    const state = createHistogramState("sync.catchup_ms");
    recordHistogram("sync.catchup_ms", state, 1);
    recordHistogram("sync.catchup_ms", state, 100);

    expect(state.counts.reduce((a, b) => a + b, 0)).toBe(2);
  });

  test("ignores negative and non-finite values", () => {
    const state = createHistogramState("buffer.wait_ms");
    for (const value of [-1, NaN, Infinity]) {
      recordHistogram("buffer.wait_ms", state, value);
    }

    expect(state.count).toBe(0);
    expect(state.sum).toBe(0);
  });

  test("the snapshot carries its bounds and is a copy", () => {
    const state = createHistogramState("buffer.wait_ms");
    recordHistogram("buffer.wait_ms", state, 1);
    const snapshot = snapshotHistogram("buffer.wait_ms", state);
    recordHistogram("buffer.wait_ms", state, 1);

    expect(snapshot.bounds).toEqual(HISTOGRAM_BOUNDS["buffer.wait_ms"]);
    expect(snapshot.count).toBe(1);
  });

  test("ignores a histogram name it does not know", () => {
    const histograms = createHistograms();

    expect(() =>
      recordSample(histograms, "sync.new_thing_ms", 5),
    ).not.toThrow();
    recordSample(histograms, "buffer.wait_ms", 5);

    expect(histograms["buffer.wait_ms"].count).toBe(1);
    expect(Object.keys(histograms).length).toBe(4);
  });
});
