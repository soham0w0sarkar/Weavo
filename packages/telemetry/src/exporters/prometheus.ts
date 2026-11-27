import { counterLabelKey } from "../client/routes";
import type { TelemetrySnapshot } from "../client/types";
import { histogramSamples, type MetricFamily } from "./families";

const escapeLabel = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');

const labelText = (labels: Record<string, string>) => {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  const body = entries
    .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
    .join(",");
  return `{${body}}`;
};

const formatValue = (value: number) =>
  value === Number.POSITIVE_INFINITY ? "+Inf" : String(value);

/** Prometheus text exposition format 0.0.4. */
export const formatPrometheus = (families: MetricFamily[]): string => {
  const lines: string[] = [];
  for (const family of families) {
    lines.push(`# HELP ${family.name} ${family.help}`);
    lines.push(`# TYPE ${family.name} ${family.type}`);
    for (const sample of family.samples) {
      lines.push(
        `${sample.name}${labelText(sample.labels)} ${formatValue(sample.value)}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
};

export const snake = (name: string) => name.replace(/\./g, "_");

const splitLabel = (key: string): [string, string | undefined] => {
  const at = key.indexOf(":");
  return at < 0 ? [key, undefined] : [key.slice(0, at), key.slice(at + 1)];
};

// Gauges whose name is `<base>:<state>`, like status.current:ready.
const GAUGE_LABEL_KEYS: Record<string, string> = {
  "status.current": "status",
  "transport.current": "transport",
};

// op.buffered is a counter family but not a routed event, so it is not in the
// routing table. Its label key is fixed here.
const COUNTER_LABEL_KEYS: Record<string, string> = { "op.buffered": "reason" };

const labelKeyFor = (base: string) =>
  COUNTER_LABEL_KEYS[base] ?? counterLabelKey(base) ?? "label";

/**
 * Maps a client snapshot to families. Counters become `<name>_total` with the
 * detail as a label, so no name is ever built from user data. Histograms keep
 * their own name and gain the bucket samples.
 */
export const clientFamilies = (snapshot: TelemetrySnapshot): MetricFamily[] => {
  const families = new Map<string, MetricFamily>();
  const family = (name: string, type: MetricFamily["type"], help: string) => {
    let existing = families.get(name);
    if (!existing) {
      existing = { name, type, help, samples: [] };
      families.set(name, existing);
    }
    return existing;
  };

  for (const [key, value] of Object.entries(snapshot.counters)) {
    const [base, label] = splitLabel(key);
    const name = `weavo_client_${snake(base)}_total`;
    const labels: Record<string, string> = {};
    if (label !== undefined) labels[labelKeyFor(base)] = label;
    family(name, "counter", `Client counter ${base}`).samples.push({
      name,
      labels,
      value,
    });
  }

  for (const [key, value] of Object.entries(snapshot.gauges)) {
    const [base, state] = splitLabel(key);
    const name = `weavo_client_${snake(base)}`;
    const labels: Record<string, string> = {};
    if (state !== undefined) labels[GAUGE_LABEL_KEYS[base] ?? "state"] = state;
    family(name, "gauge", `Client gauge ${base}`).samples.push({
      name,
      labels,
      value,
    });
  }

  for (const [key, histogram] of Object.entries(snapshot.histograms)) {
    const name = `weavo_client_${snake(key)}`;
    const existing = family(name, "histogram", `Client histogram ${key}`);
    existing.samples = histogramSamples(
      name,
      histogram.bounds,
      histogram.counts,
      histogram.sum,
      histogram.count,
    );
  }

  return [...families.values()];
};
