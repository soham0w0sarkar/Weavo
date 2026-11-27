import type { MetricFamily } from "./families";

export type OtelAttributes = Record<string, string>;

/** Shape of OpenTelemetry's ObservableResult, so a real Meter fits without an import. */
export type ObservableResultLike = {
  observe(value: number, attributes?: OtelAttributes): void;
};

export type ObservableInstrumentLike = {
  addCallback(callback: (result: ObservableResultLike) => void): void;
};

/** Shape of the parts of OpenTelemetry's Meter this adapter uses. */
export type MeterLike = {
  createObservableCounter(
    name: string,
    options?: { description?: string },
  ): ObservableInstrumentLike;
  createObservableGauge(
    name: string,
    options?: { description?: string },
  ): ObservableInstrumentLike;
};

/**
 * Registers one observable instrument per sample name. Sample names never
 * change for a collector (every counter, gauge and bucket exists from the
 * start), so they are read once here. Each callback reads the current families
 * when the SDK collects and reports its own samples.
 *
 * Histograms are sent as observable counters per bucket (`_bucket` with an
 * `le` attribute, plus `_sum` and `_count`). OpenTelemetry's histogram
 * instrument cannot take bucket counts that were already accumulated, and
 * replaying samples would need unbounded memory.
 */
export const bindOtel = (
  meter: MeterLike,
  read: () => MetricFamily[],
): void => {
  const kinds = new Map<string, "counter" | "gauge">();
  for (const family of read()) {
    for (const sample of family.samples) {
      if (!kinds.has(sample.name)) {
        kinds.set(sample.name, family.type === "gauge" ? "gauge" : "counter");
      }
    }
  }

  for (const [name, kind] of kinds) {
    const instrument =
      kind === "gauge"
        ? meter.createObservableGauge(name)
        : meter.createObservableCounter(name);

    instrument.addCallback((result) => {
      for (const family of read()) {
        for (const sample of family.samples) {
          if (sample.name === name) result.observe(sample.value, sample.labels);
        }
      }
    });
  }
};
