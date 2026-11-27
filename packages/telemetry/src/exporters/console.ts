import type { TelemetrySnapshot } from "../client/types";

export type ConsoleExporterOptions = {
  intervalMs?: number;
  log?: (text: string) => void;
};

const bucketLabel = (bounds: readonly number[], slot: number) =>
  slot < bounds.length ? `<=${bounds[slot]}` : `>${bounds.at(-1)}`;

export const formatSnapshot = (snapshot: TelemetrySnapshot): string => {
  const counters = Object.entries(snapshot.counters)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => `${name}=${value}`);
  const gauges = Object.entries(snapshot.gauges).map(
    ([name, value]) => `${name}=${value}`,
  );
  const histograms = Object.entries(snapshot.histograms)
    .filter(([, histogram]) => histogram.count > 0)
    .map(([name, { bounds, counts, count, sum }]) => {
      const buckets = counts
        .map((n, slot) => (n > 0 ? `${bucketLabel(bounds, slot)}:${n}` : ""))
        .filter(Boolean);
      return `${name} n=${count} sum=${+sum.toFixed(2)} [${buckets.join(" ")}]`;
    });

  return [
    `counters   ${counters.join("  ") || "(all zero)"}`,
    `gauges     ${gauges.join("  ")}`,
    `histograms ${histograms.join("  |  ") || "(empty)"}`,
  ].join("\n");
};

export const startConsoleExporter = (
  source: { snapshot: () => TelemetrySnapshot },
  { intervalMs = 5_000, log = console.log }: ConsoleExporterOptions = {},
): (() => void) => {
  const timer = setInterval(
    () => log(formatSnapshot(source.snapshot())),
    intervalMs,
  );
  return () => clearInterval(timer);
};
