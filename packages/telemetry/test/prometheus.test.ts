import { describe, expect, test } from "bun:test";
import { createClientTelemetry } from "../src";
import { clientFamilies, formatPrometheus } from "../src/exporters/prometheus";
import type { MetricFamily } from "../src/exporters/families";
import { histogramSamples } from "../src/exporters/families";

const lineOf = (text: string, prefix: string) =>
  text.split("\n").find((line) => line.startsWith(prefix));

describe("formatPrometheus", () => {
  test("writes HELP and TYPE, then one line per sample", () => {
    const families: MetricFamily[] = [
      {
        name: "weavo_test_total",
        type: "counter",
        help: "A test counter",
        samples: [
          { name: "weavo_test_total", labels: { reason: "a" }, value: 2 },
          { name: "weavo_test_total", labels: {}, value: 0 },
        ],
      },
    ];

    expect(formatPrometheus(families)).toBe(
      [
        "# HELP weavo_test_total A test counter",
        "# TYPE weavo_test_total counter",
        'weavo_test_total{reason="a"} 2',
        "weavo_test_total 0",
        "",
      ].join("\n"),
    );
  });

  test("escapes label values", () => {
    const text = formatPrometheus([
      {
        name: "weavo_x",
        type: "gauge",
        help: "x",
        samples: [{ name: "weavo_x", labels: { v: 'a"b\\c\nd' }, value: 1 }],
      },
    ]);

    expect(text).toContain('weavo_x{v="a\\"b\\\\c\\nd"} 1');
  });
});

describe("histogram samples", () => {
  test("buckets are cumulative and end with +Inf equal to count", () => {
    const samples = histogramSamples("h", [1, 10], [2, 3, 4], 99, 9);
    const values = Object.fromEntries(
      samples.map((s) => [`${s.name}|${s.labels["le"] ?? ""}`, s.value]),
    );

    expect(values["h_bucket|1"]).toBe(2);
    expect(values["h_bucket|10"]).toBe(5);
    expect(values["h_bucket|+Inf"]).toBe(9);
    expect(values["h_sum|"]).toBe(99);
    expect(values["h_count|"]).toBe(9);
  });
});

describe("client snapshot as Prometheus", () => {
  test("counters become _total families with their detail as a label", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.count("op.buffered:missing-origin");
    hook.count("op.flushed");
    hook.event("peer.evicted", { reason: "suspect" });

    const text = formatPrometheus(clientFamilies(snapshot()));

    expect(
      lineOf(text, 'weavo_client_op_buffered_total{reason="missing-origin"}'),
    ).toBe('weavo_client_op_buffered_total{reason="missing-origin"} 1');
    expect(
      lineOf(
        text,
        'weavo_client_op_buffered_total{reason="missing-membership"}',
      ),
    ).toBe('weavo_client_op_buffered_total{reason="missing-membership"} 0');
    expect(lineOf(text, "weavo_client_op_flushed_total ")).toBe(
      "weavo_client_op_flushed_total 1",
    );
    expect(
      lineOf(text, 'weavo_client_peer_evicted_total{reason="suspect"}'),
    ).toBe('weavo_client_peer_evicted_total{reason="suspect"} 1');
    expect(lineOf(text, "weavo_client_gc_sweep_total ")).toBe(
      "weavo_client_gc_sweep_total 0",
    );
  });

  test("state gauges are one-hot, labelled by state", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.attach({ "status.current:ready": () => 1 });

    const families = clientFamilies(snapshot());
    const status = families.find(
      (f) => f.name === "weavo_client_status_current",
    );

    expect(status?.type).toBe("gauge");
    expect(status?.samples).toHaveLength(6);
    expect(
      status?.samples.find((s) => s.labels["status"] === "ready")?.value,
    ).toBe(1);
    expect(
      status?.samples.find((s) => s.labels["status"] === "joining")?.value,
    ).toBe(0);
  });

  test("histograms expose cumulative buckets with +Inf equal to the count", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.record("buffer.wait_ms", 0.6);
    hook.record("buffer.wait_ms", 3_000);

    const text = formatPrometheus(clientFamilies(snapshot()));

    expect(lineOf(text, 'weavo_client_buffer_wait_ms_bucket{le="1"}')).toBe(
      'weavo_client_buffer_wait_ms_bucket{le="1"} 1',
    );
    expect(lineOf(text, 'weavo_client_buffer_wait_ms_bucket{le="+Inf"}')).toBe(
      'weavo_client_buffer_wait_ms_bucket{le="+Inf"} 2',
    );
    expect(lineOf(text, "weavo_client_buffer_wait_ms_count ")).toBe(
      "weavo_client_buffer_wait_ms_count 2",
    );
  });

  test("every family name is unique and valid", () => {
    const { snapshot } = createClientTelemetry();
    const names = clientFamilies(snapshot()).map((f) => f.name);

    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-zA-Z_:][a-zA-Z0-9_:]*$/);
    }
  });
});
