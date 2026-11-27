import { describe, expect, test } from "bun:test";
import { createClientTelemetry } from "../src";
import {
  buildOtlpRequest,
  roomLabel,
  startOtlpPush,
} from "../src/exporters/otlp";

const CLOCK = { instanceId: "tab-1", startedAtMs: 1_000, nowMs: 2_000 };

const metricsOf = (payload: ReturnType<typeof buildOtlpRequest>) =>
  payload.resourceMetrics[0]!.scopeMetrics[0]!.metrics;

const find = (payload: ReturnType<typeof buildOtlpRequest>, name: string) => {
  const metric = metricsOf(payload).find((m) => m.name === name);
  if (!metric) throw new Error(`missing ${name}`);
  return metric;
};

describe("buildOtlpRequest", () => {
  test("identifies the service and this page load", () => {
    const { snapshot } = createClientTelemetry();
    const [resource] = buildOtlpRequest(snapshot(), CLOCK).resourceMetrics;

    expect(resource!.resource.attributes).toEqual([
      { key: "service.name", value: { stringValue: "weavo-client" } },
      { key: "service.instance.id", value: { stringValue: "tab-1" } },
    ]);
  });

  test("counters are cumulative monotonic sums, as strings-free doubles", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.count("op.flushed");
    hook.count("op.flushed");

    const metric = find(
      buildOtlpRequest(snapshot(), CLOCK),
      "weavo_client_op_flushed_total",
    );

    expect(metric.sum?.aggregationTemporality).toBe(2);
    expect(metric.sum?.isMonotonic).toBe(true);
    expect(metric.sum?.dataPoints[0]?.asDouble).toBe(2);
    expect(metric.sum?.dataPoints[0]?.startTimeUnixNano).toBe("1000000000");
    expect(metric.sum?.dataPoints[0]?.timeUnixNano).toBe("2000000000");
  });

  test("detail values become attributes, and zero series are still sent", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.count("op.buffered:missing-origin");
    const points = find(
      buildOtlpRequest(snapshot(), CLOCK),
      "weavo_client_op_buffered_total",
    ).sum!.dataPoints;

    expect(
      points.find(
        (p) => p.attributes[0]?.value.stringValue === "missing-origin",
      )?.asDouble,
    ).toBe(1);
    expect(
      points.find(
        (p) => p.attributes[0]?.value.stringValue === "missing-target",
      )?.asDouble,
    ).toBe(0);
  });

  test("gauges are sent as gauges, one-hot by state", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.attach({ "status.current:ready": () => 1, "doc.nodes": () => 7 });
    const payload = buildOtlpRequest(snapshot(), CLOCK);

    const status = find(payload, "weavo_client_status_current");
    expect(status.gauge).toBeDefined();
    expect(
      status.gauge!.dataPoints.find(
        (p) => p.attributes[0]?.value.stringValue === "ready",
      )?.asDouble,
    ).toBe(1);
    expect(
      find(payload, "weavo_client_doc_nodes").gauge?.dataPoints[0]?.asDouble,
    ).toBe(7);
  });

  test("histograms keep non-cumulative counts with one slot per bound plus overflow", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.record("buffer.wait_ms", 0.6);
    hook.record("buffer.wait_ms", 5_000);

    const point = find(
      buildOtlpRequest(snapshot(), CLOCK),
      "weavo_client_buffer_wait_ms",
    ).histogram!.dataPoints[0]!;

    expect(point.explicitBounds.length + 1).toBe(point.bucketCounts.length);
    // The first bound is 0.5 ms, so 0.6 ms lands in the slot for (0.5, 1].
    expect(point.explicitBounds[0]).toBe(0.5);
    expect(point.bucketCounts[0]).toBe("0");
    expect(point.bucketCounts[1]).toBe("1");
    expect(point.bucketCounts.at(-1)).toBe("1");
    expect(point.count).toBe("2");
    expect(point.sum).toBeCloseTo(5_000.6);
    const total = point.bucketCounts.reduce((sum, n) => sum + Number(n), 0);
    expect(total).toBe(Number(point.count));
  });

  test("histogram families are not duplicated as sums", () => {
    const { snapshot } = createClientTelemetry();
    const names = metricsOf(buildOtlpRequest(snapshot(), CLOCK)).map(
      (m) => m.name,
    );

    expect(names.some((n) => n.endsWith("_bucket"))).toBe(false);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("startOtlpPush", () => {
  test("posts JSON to the url on each tick and stops when asked", async () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.count("op.flushed");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;

    const stop = startOtlpPush(
      { snapshot },
      {
        url: "http://collector.test/v1/metrics",
        intervalMs: 5,
        fetch: fakeFetch,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    const sent = calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sent).toBeGreaterThanOrEqual(2);
    expect(calls.length).toBe(sent);
    expect(calls[0]!.url).toBe("http://collector.test/v1/metrics");
    expect(calls[0]!.init.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.resourceMetrics).toBeArray();
  });

  test("a failing collector never throws out of the timer", async () => {
    const { snapshot } = createClientTelemetry();
    const failing = (() =>
      Promise.reject(new Error("down"))) as unknown as typeof fetch;

    const stop = startOtlpPush(
      { snapshot },
      { url: "http://collector.test", intervalMs: 5, fetch: failing },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();

    expect(true).toBe(true);
  });
});

describe("per-room label", () => {
  const ROOM = "3ecd8df3-d520-48ae-af11-6e85aa5fabc9";

  test("roomLabel is 8 hex characters, stable, and different per room", () => {
    const label = roomLabel(ROOM);

    expect(label).toMatch(/^[0-9a-f]{8}$/);
    expect(roomLabel(ROOM)).toBe(label);
    expect(roomLabel("c9959074-0d67-4655-a373-2e1163a96395")).not.toBe(label);
    expect(label).not.toContain("3ecd");
  });

  test("buildOtlpRequest puts weavo.room on counters, gauges and histograms", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.count("op.flushed");
    hook.attach({ "doc.nodes": () => 4 });
    hook.record("buffer.wait_ms", 2);
    const room = roomLabel(ROOM);

    const metrics = buildOtlpRequest(snapshot(), { ...CLOCK, room })
      .resourceMetrics[0]!.scopeMetrics[0]!.metrics;
    const hasRoom = (point: {
      attributes: Array<{ key: string; value: { stringValue: string } }>;
    }) =>
      point.attributes.some(
        (a) => a.key === "weavo.room" && a.value.stringValue === room,
      );

    const flushed = metrics.find(
      (m) => m.name === "weavo_client_op_flushed_total",
    )!;
    const nodes = metrics.find((m) => m.name === "weavo_client_doc_nodes")!;
    const wait = metrics.find((m) => m.name === "weavo_client_buffer_wait_ms")!;
    expect(hasRoom(flushed.sum!.dataPoints[0]!)).toBe(true);
    expect(hasRoom(nodes.gauge!.dataPoints[0]!)).toBe(true);
    expect(hasRoom(wait.histogram!.dataPoints[0]!)).toBe(true);
  });

  test("without a room, no weavo.room attribute is sent", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.count("op.flushed");

    const body = JSON.stringify(buildOtlpRequest(snapshot(), CLOCK));

    expect(body).not.toContain("weavo.room");
  });

  test("startOtlpPush sends the hashed label and never the raw room id", async () => {
    const { snapshot } = createClientTelemetry();
    const bodies: string[] = [];
    const fakeFetch = ((_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;

    const stop = startOtlpPush(
      { snapshot },
      {
        url: "http://collector.test",
        intervalMs: 5,
        room: ROOM,
        fetch: fakeFetch,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();

    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).toContain(roomLabel(ROOM));
      expect(body).not.toContain(ROOM);
    }
  });
});
