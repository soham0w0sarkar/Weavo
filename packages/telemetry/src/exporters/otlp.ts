import type { TelemetrySnapshot } from "../client/types";
import type { MetricFamily } from "./families";
import { clientFamilies, snake } from "./prometheus";

/**
 * Pushes client metrics to an OpenTelemetry Collector over OTLP/HTTP (JSON).
 * No dependencies: the payload is written by hand from the same snapshot the
 * other exporters read.
 *
 * Every temporality is cumulative, so the collector can compute rates from
 * any two pushes. Each page load gets its own `service.instance.id`, because
 * two tabs sending cumulative values into one series would look like resets.
 */

const CUMULATIVE = 2;

type Attribute = { key: string; value: { stringValue: string } };

type NumberPoint = {
  attributes: Attribute[];
  startTimeUnixNano: string;
  timeUnixNano: string;
  asDouble: number;
};

type HistogramPoint = {
  attributes: Attribute[];
  startTimeUnixNano: string;
  timeUnixNano: string;
  count: string;
  sum: number;
  bucketCounts: string[];
  explicitBounds: number[];
};

type OtlpMetric = {
  name: string;
  description: string;
  sum?: {
    aggregationTemporality: number;
    isMonotonic: boolean;
    dataPoints: NumberPoint[];
  };
  gauge?: { dataPoints: NumberPoint[] };
  histogram?: {
    aggregationTemporality: number;
    dataPoints: HistogramPoint[];
  };
};

export type OtlpPayload = {
  resourceMetrics: Array<{
    resource: { attributes: Attribute[] };
    scopeMetrics: Array<{ scope: { name: string }; metrics: OtlpMetric[] }>;
  }>;
};

export type OtlpBuildOptions = {
  instanceId: string;
  /** Wall-clock ms when this page started. Cumulative series start here. */
  startedAtMs: number;
  nowMs: number;
  /** Already-hashed room label, from roomLabel(). Added to every data point. */
  room?: string | undefined;
};

/**
 * A short, stable label for a room id. A room id is a join key, so the raw
 * value never leaves the page. FNV-1a is enough here: the inputs are random
 * UUIDs, so nothing can be recovered from the 32-bit label.
 */
export const roomLabel = (room: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < room.length; index++) {
    hash ^= room.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const MS_TO_NS = BigInt(1_000_000);

// OTLP JSON encodes 64-bit integers as strings.
const nanos = (ms: number) => (BigInt(Math.floor(ms)) * MS_TO_NS).toString();

const attribute = (key: string, value: string): Attribute => ({
  key,
  value: { stringValue: value },
});

const toAttributes = (labels: Record<string, string>): Attribute[] =>
  Object.entries(labels).map(([key, value]) => attribute(key, value));

const familyMetrics = (
  families: MetricFamily[],
  start: string,
  now: string,
  extra: Attribute[],
): OtlpMetric[] => {
  const metrics: OtlpMetric[] = [];
  for (const family of families) {
    // Histograms come from the snapshot, below. clientFamilies expands them
    // into _bucket samples, which OTLP does not need.
    if (family.type === "histogram") continue;
    const dataPoints = family.samples.map<NumberPoint>((sample) => ({
      attributes: [...toAttributes(sample.labels), ...extra],
      startTimeUnixNano: start,
      timeUnixNano: now,
      asDouble: sample.value,
    }));
    metrics.push(
      family.type === "counter"
        ? {
            name: family.name,
            description: family.help,
            sum: {
              aggregationTemporality: CUMULATIVE,
              isMonotonic: true,
              dataPoints,
            },
          }
        : {
            name: family.name,
            description: family.help,
            gauge: { dataPoints },
          },
    );
  }
  return metrics;
};

const histogramMetrics = (
  snapshot: TelemetrySnapshot,
  start: string,
  now: string,
  extra: Attribute[],
): OtlpMetric[] =>
  Object.entries(snapshot.histograms).map(([key, histogram]) => ({
    name: `weavo_client_${snake(key)}`,
    description: `Client histogram ${key}`,
    histogram: {
      aggregationTemporality: CUMULATIVE,
      dataPoints: [
        {
          attributes: extra,
          startTimeUnixNano: start,
          timeUnixNano: now,
          count: String(histogram.count),
          sum: histogram.sum,
          // Non-cumulative, as OTLP expects. Length is bounds + 1 by construction.
          bucketCounts: histogram.counts.map(String),
          explicitBounds: [...histogram.bounds],
        },
      ],
    },
  }));

export const buildOtlpRequest = (
  snapshot: TelemetrySnapshot,
  options: OtlpBuildOptions,
): OtlpPayload => {
  const start = nanos(options.startedAtMs);
  const now = nanos(options.nowMs);
  const extra =
    options.room === undefined ? [] : [attribute("weavo.room", options.room)];
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            attribute("service.name", "weavo-client"),
            attribute("service.instance.id", options.instanceId),
          ],
        },
        scopeMetrics: [
          {
            scope: { name: "@weavo/telemetry" },
            metrics: [
              ...familyMetrics(clientFamilies(snapshot), start, now, extra),
              ...histogramMetrics(snapshot, start, now, extra),
            ],
          },
        ],
      },
    ],
  };
};

export type OtlpPushOptions = {
  /** Full OTLP/HTTP metrics URL, for example http://localhost:4318/v1/metrics. */
  url: string;
  intervalMs?: number;
  /** Raw room id. It is hashed with roomLabel() before it is sent. */
  room?: string;
  /** Replaceable for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
};

const newInstanceId = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

/**
 * Sends a snapshot every `intervalMs`. Failures are dropped: a missing
 * collector must never affect editing, and the next push carries the full
 * cumulative state anyway. Returns a function that stops the timer.
 */
export const startOtlpPush = (
  source: { snapshot: () => TelemetrySnapshot },
  options: OtlpPushOptions,
): (() => void) => {
  const send = options.fetch ?? fetch;
  const instanceId = newInstanceId();
  const startedAtMs = Date.now();
  const room = options.room === undefined ? undefined : roomLabel(options.room);

  const tick = () => {
    try {
      const body = JSON.stringify(
        buildOtlpRequest(source.snapshot(), {
          instanceId,
          startedAtMs,
          nowMs: Date.now(),
          room,
        }),
      );
      send(options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Dropped on purpose; see the doc comment.
    }
  };

  const timer = setInterval(tick, options.intervalMs ?? 5_000);
  return () => clearInterval(timer);
};
