import { describe, expect, test } from "bun:test";
import {
  bindOtel,
  type MeterLike,
  type OtelAttributes,
} from "../src/exporters/otel";
import { createClientTelemetry } from "../src";
import { clientFamilies } from "../src/exporters/prometheus";
import type { MetricFamily } from "../src/exporters/families";

type Recorded = {
  kind: "counter" | "gauge";
  name: string;
  callbacks: Array<
    (result: { observe(v: number, a?: OtelAttributes): void }) => void
  >;
};

const fakeMeter = () => {
  const instruments: Recorded[] = [];
  const make = (kind: Recorded["kind"]) => (name: string) => {
    const instrument: Recorded = { kind, name, callbacks: [] };
    instruments.push(instrument);
    return {
      addCallback: (cb: Recorded["callbacks"][number]) =>
        void instrument.callbacks.push(cb),
    };
  };
  const meter: MeterLike = {
    createObservableCounter: make("counter"),
    createObservableGauge: make("gauge"),
  };
  const collect = () => {
    const observed: Array<{
      name: string;
      value: number;
      attributes?: OtelAttributes;
    }> = [];
    for (const instrument of instruments) {
      for (const cb of instrument.callbacks) {
        cb({
          observe: (value, attributes) =>
            observed.push({
              name: instrument.name,
              value,
              ...(attributes ? { attributes } : {}),
            }),
        });
      }
    }
    return observed;
  };
  return { meter, instruments, collect };
};

describe("bindOtel", () => {
  test("creates one instrument per sample name, with the right kind", () => {
    const { meter, instruments } = fakeMeter();
    const { snapshot } = createClientTelemetry();
    bindOtel(meter, () => clientFamilies(snapshot()));

    const names = instruments.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
    expect(
      instruments.find((i) => i.name === "weavo_client_op_flushed_total")?.kind,
    ).toBe("counter");
    expect(
      instruments.find((i) => i.name === "weavo_client_doc_nodes")?.kind,
    ).toBe("gauge");
    expect(
      instruments.find((i) => i.name === "weavo_client_buffer_wait_ms_bucket")
        ?.kind,
    ).toBe("counter");
  });

  test("each collection reports the current values with their attributes", () => {
    const { meter, collect } = fakeMeter();
    const { hook, snapshot } = createClientTelemetry();
    bindOtel(meter, () => clientFamilies(snapshot()));

    hook.count("op.buffered:missing-origin");
    hook.count("op.flushed");
    const first = collect();

    hook.count("op.flushed");
    const second = collect();

    const flushed = (rows: typeof first) =>
      rows.find((r) => r.name === "weavo_client_op_flushed_total")?.value;
    expect(flushed(first)).toBe(1);
    expect(flushed(second)).toBe(2);

    const buffered = first.find(
      (r) =>
        r.name === "weavo_client_op_buffered_total" &&
        r.attributes?.["reason"] === "missing-origin",
    );
    expect(buffered?.value).toBe(1);
  });

  test("histogram buckets come through with le attributes", () => {
    const { meter, collect } = fakeMeter();
    const { hook, snapshot } = createClientTelemetry();
    bindOtel(meter, () => clientFamilies(snapshot()));

    hook.record("buffer.wait_ms", 0.6);
    const rows = collect().filter(
      (r) => r.name === "weavo_client_buffer_wait_ms_bucket",
    );

    expect(rows.find((r) => r.attributes?.["le"] === "1")?.value).toBe(1);
    expect(rows.find((r) => r.attributes?.["le"] === "+Inf")?.value).toBe(1);
  });

  test("the same families produce the same samples as the Prometheus view", () => {
    const { meter, collect } = fakeMeter();
    const { hook, snapshot } = createClientTelemetry();
    const read = (): MetricFamily[] => clientFamilies(snapshot());
    bindOtel(meter, read);
    hook.event("join.end", { outcome: "joined", durationMs: 12 });

    const observed = collect();
    const expected = read().flatMap((f) => f.samples);

    expect(observed).toHaveLength(expected.length);
    for (const sample of expected) {
      const match = observed.find(
        (o) =>
          o.name === sample.name &&
          o.value === sample.value &&
          JSON.stringify(o.attributes ?? {}) === JSON.stringify(sample.labels),
      );
      expect(match).toBeDefined();
    }
  });
});
