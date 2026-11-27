import type { TelemetryEventDetails, TelemetryEventName } from "@weavo/client";
import { bumpCounter, recordSample } from "./state";
import type {
  Counters,
  EventHistogramName,
  HistogramName,
  HistogramState,
} from "./types";

type Details<K extends TelemetryEventName> = TelemetryEventDetails[K];

type KeysOf<K extends TelemetryEventName, V> = {
  [F in keyof Details<K>]-?: [Details<K>[F]] extends [never]
    ? never
    : Details<K>[F] extends V
      ? F
      : never;
}[keyof Details<K>];

type EventRoute<K extends TelemetryEventName> = {
  readonly label?: KeysOf<K, string>;
  readonly histogram?: {
    readonly name: EventHistogramName;
    readonly field: KeysOf<K, number>;
  };
};

export const EVENT_ROUTES = {
  "transport.state": { label: "state" },
  "status.change": { label: "status" },
  "join.end": {
    label: "outcome",
    histogram: { name: "membership.join_ms", field: "durationMs" },
  },
  "consensus.retry": {},
  "consensus.end": {
    label: "outcome",
    histogram: { name: "consensus.round_ms", field: "durationMs" },
  },
  "sync.end": {
    label: "outcome",
    histogram: { name: "sync.catchup_ms", field: "durationMs" },
  },
  "sync.request_sent": {},
  "sync.response_sent": {},
  "sync.suppressed": {},
  "sync.chunk": {},
  "sync.claim": {},
  "sync.takeover": {},
  "sync.stall": {},
  "peer.evicted": { label: "reason" },
  "gc.sweep": {},
  "buffer.cap_hit": {},
  "membership.fork": {},
} as const satisfies { [K in TelemetryEventName]: EventRoute<K> };

type CounterOf<K extends TelemetryEventName> =
  (typeof EVENT_ROUTES)[K] extends { readonly label: infer L }
    ? L extends keyof Details<K>
      ? `${K}:${Details<K>[L] & string}`
      : never
    : K;

export type EventCounterName = {
  [K in TelemetryEventName]: CounterOf<K>;
}[TelemetryEventName];

type LooseRoute = {
  readonly label?: string;
  readonly histogram?: { readonly name: string; readonly field: string };
};

export const applyEvent = (
  counters: Counters,
  histograms: Record<HistogramName, HistogramState>,
  name: string,
  details: Record<string, unknown>,
) => {
  if (!Object.hasOwn(EVENT_ROUTES, name)) return;
  const route: LooseRoute = EVENT_ROUTES[name as TelemetryEventName];

  bumpCounter(
    counters,
    route.label ? `${name}:${String(details[route.label])}` : name,
  );

  if (route.histogram) {
    const value = details[route.histogram.field];
    if (typeof value === "number") {
      recordSample(histograms, route.histogram.name, value);
    }
  }
};
