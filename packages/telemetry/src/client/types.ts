import type {
  TelemetryCounterName,
  TelemetryGaugeName,
  TelemetryGauges,
  TelemetryHistogramName,
} from "@weavo/client";
import type { EventCounterName } from "./routes";

export type HotCounterName = TelemetryCounterName;

export type CounterName = EventCounterName | HotCounterName;

export type GaugeName = TelemetryGaugeName;

export type EventHistogramName =
  | "membership.join_ms"
  | "consensus.round_ms"
  | "sync.catchup_ms";
export type HotHistogramName = TelemetryHistogramName;
export type HistogramName = EventHistogramName | HotHistogramName;

export type Counters = Record<CounterName, number>;

export type GaugeGetters = TelemetryGauges;
export type GaugeValues = Record<GaugeName, number>;

export type HistogramState = {
  counts: number[];
  sum: number;
  count: number;
};

export type HistogramSnapshot = {
  bounds: readonly number[];
  counts: readonly number[];
  sum: number;
  count: number;
};

export type TelemetryState = {
  counters: Counters;
  gauges: GaugeGetters;
  histograms: Record<HistogramName, HistogramState>;
};

export type TelemetrySnapshot = {
  counters: Counters;
  gauges: GaugeValues;
  histograms: Record<HistogramName, HistogramSnapshot>;
};
