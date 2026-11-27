import { describe, expect, test } from "bun:test";
import { applyEvent, EVENT_ROUTES } from "../src/client/routes";
import {
  createCounters,
  createHistograms,
  snapshotHistogram,
} from "../src/client/state";

const setup = () => ({
  counters: createCounters(),
  histograms: createHistograms(),
});

describe("event routes", () => {
  test("an event bumps its own counter", () => {
    const { counters, histograms } = setup();
    applyEvent(counters, histograms, "sync.chunk", { ops: 40 });

    expect(counters["sync.chunk"]).toBe(1);
  });

  test("a labelled event bumps the counter with the detail in its name", () => {
    const { counters, histograms } = setup();
    applyEvent(counters, histograms, "peer.evicted", { reason: "suspect" });
    applyEvent(counters, histograms, "transport.state", {
      state: "backoff",
      attempt: 2,
    });

    expect(counters["peer.evicted:suspect"]).toBe(1);
    expect(counters["transport.state:backoff"]).toBe(1);
    expect(counters["peer.evicted:expired"]).toBe(0);
  });

  test("an end event feeds its histogram from the duration field", () => {
    const { counters, histograms } = setup();
    applyEvent(counters, histograms, "join.end", {
      outcome: "joined",
      durationMs: 30,
    });

    const snapshot = snapshotHistogram(
      "membership.join_ms",
      histograms["membership.join_ms"],
    );
    expect(counters["join.end:joined"]).toBe(1);
    expect(snapshot.count).toBe(1);
    expect(snapshot.sum).toBe(30);
    expect(histograms["consensus.round_ms"].count).toBe(0);
  });

  test("each end event feeds its own histogram", () => {
    const { counters, histograms } = setup();
    applyEvent(counters, histograms, "consensus.end", {
      outcome: "committed",
      durationMs: 5,
      version: 2,
      carriedForward: false,
    });
    applyEvent(counters, histograms, "sync.end", {
      outcome: "timeout",
      durationMs: 9_000,
    });

    expect(histograms["consensus.round_ms"].count).toBe(1);
    expect(histograms["sync.catchup_ms"].count).toBe(1);
    expect(counters["sync.end:timeout"]).toBe(1);
  });

  test("a missing or non-numeric duration records nothing", () => {
    const { counters, histograms } = setup();
    applyEvent(counters, histograms, "join.end", { outcome: "failed" });
    applyEvent(counters, histograms, "join.end", {
      outcome: "failed",
      durationMs: "slow",
    });

    expect(counters["join.end:failed"]).toBe(2);
    expect(histograms["membership.join_ms"].count).toBe(0);
  });

  test("ignores an event it does not know", () => {
    const { counters, histograms } = setup();
    const before = JSON.stringify(counters);

    applyEvent(counters, histograms, "sync.something_new", { ops: 1 });
    applyEvent(counters, histograms, "__proto__", {});

    expect(JSON.stringify(counters)).toBe(before);
  });

  test("ignores a label value it does not know", () => {
    const { counters, histograms } = setup();
    const before = Object.keys(counters).length;

    applyEvent(counters, histograms, "peer.evicted", { reason: "banned" });

    expect(Object.keys(counters).length).toBe(before);
    expect(counters["peer.evicted:suspect"]).toBe(0);
  });

  test("every unlabelled route has a counter", () => {
    const counters = createCounters();
    const unlabelled = Object.entries(EVENT_ROUTES)
      .filter(([, route]) => !("label" in route))
      .map(([name]) => name);

    expect(unlabelled.length).toBeGreaterThan(0);
    for (const name of unlabelled) {
      expect(Object.hasOwn(counters, name)).toBe(true);
    }
  });
});
