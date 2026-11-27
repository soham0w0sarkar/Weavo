/**
 * The exporters share one model. A snapshot becomes families of samples, and
 * each exporter only changes how families are written out.
 */
export type MetricType = "counter" | "gauge" | "histogram";

export type MetricSample = {
  name: string;
  labels: Record<string, string>;
  value: number;
};

export type MetricFamily = {
  name: string;
  type: MetricType;
  help: string;
  samples: MetricSample[];
};

/**
 * Turns non-cumulative histogram counts into the cumulative `_bucket`, `_sum`
 * and `_count` samples that Prometheus and OpenTelemetry expect. `counts` has
 * one more slot than `bounds`; the last slot holds values above the largest
 * bound and becomes the `+Inf` bucket.
 */
export const histogramSamples = (
  name: string,
  bounds: readonly number[],
  counts: readonly number[],
  sum: number,
  count: number,
): MetricSample[] => {
  const samples: MetricSample[] = [];
  let running = 0;
  for (let slot = 0; slot < bounds.length; slot++) {
    running += counts[slot] ?? 0;
    samples.push({
      name: `${name}_bucket`,
      labels: { le: String(bounds[slot]) },
      value: running,
    });
  }
  running += counts[bounds.length] ?? 0;
  samples.push({
    name: `${name}_bucket`,
    labels: { le: "+Inf" },
    value: running,
  });
  samples.push({ name: `${name}_sum`, labels: {}, value: sum });
  samples.push({ name: `${name}_count`, labels: {}, value: count });
  return samples;
};
