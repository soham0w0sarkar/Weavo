import type { WeavoTelemetryHook } from "@weavo/client";
import { applyEvent } from "./routes";
import {
  adoptGaugeGetters,
  bumpCounter,
  createCounters,
  createGaugeGetters,
  createHistograms,
  recordSample,
  snapshotGauges,
  snapshotHistogram,
} from "./state";
import type {
  HistogramName,
  HistogramSnapshot,
  TelemetrySnapshot,
  TelemetryState,
} from "./types";
import { HOOK_VERSION } from "./version";

export type ClientTelemetry = {
  hook: WeavoTelemetryHook;
  snapshot: () => TelemetrySnapshot;
};

export const createClientTelemetry = (): ClientTelemetry => {
  const state: TelemetryState = {
    counters: createCounters(),
    gauges: createGaugeGetters(),
    histograms: createHistograms(),
  };

  const hook: WeavoTelemetryHook = {
    version: HOOK_VERSION,
    count: (name) => bumpCounter(state.counters, name),
    event: (name, details) =>
      applyEvent(state.counters, state.histograms, name, details),
    record: (name, value) => recordSample(state.histograms, name, value),
    attach: (gauges) => adoptGaugeGetters(state.gauges, gauges),
  };

  const snapshot = (): TelemetrySnapshot => {
    const histograms = {} as Record<HistogramName, HistogramSnapshot>;
    for (const name of Object.keys(state.histograms) as HistogramName[]) {
      histograms[name] = snapshotHistogram(name, state.histograms[name]);
    }
    return {
      counters: { ...state.counters },
      gauges: snapshotGauges(state.gauges),
      histograms,
    };
  };

  return { hook, snapshot };
};
