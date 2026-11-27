import { HISTOGRAM_BOUNDS } from "./bounds";
import type {
  CounterName,
  Counters,
  GaugeGetters,
  GaugeName,
  GaugeValues,
  HistogramName,
  HistogramSnapshot,
  HistogramState,
} from "./types";

export const createCounters = (): Counters => ({
  "consensus.retry": 0,
  "sync.request_sent": 0,
  "sync.response_sent": 0,
  "sync.suppressed": 0,
  "sync.chunk": 0,
  "sync.claim": 0,
  "sync.takeover": 0,
  "sync.stall": 0,
  "gc.sweep": 0,
  "buffer.cap_hit": 0,
  "membership.fork": 0,
  "transport.state:connecting": 0,
  "transport.state:open": 0,
  "transport.state:closed": 0,
  "transport.state:backoff": 0,
  "status.change:connecting": 0,
  "status.change:joining": 0,
  "status.change:syncing": 0,
  "status.change:ready": 0,
  "status.change:reconnecting": 0,
  "status.change:disconnected": 0,
  "join.end:joined": 0,
  "join.end:founded": 0,
  "join.end:cancelled": 0,
  "join.end:timeout": 0,
  "join.end:failed": 0,
  "consensus.end:committed": 0,
  "consensus.end:preempted": 0,
  "consensus.end:cancelled": 0,
  "consensus.end:timeout": 0,
  "sync.end:complete": 0,
  "sync.end:cancelled": 0,
  "sync.end:timeout": 0,
  "sync.end:stalled": 0,
  "sync.end:failed": 0,
  "peer.evicted:suspect": 0,
  "peer.evicted:expired": 0,
  "peer.evicted:leave": 0,
  "op.buffered:missing-origin": 0,
  "op.buffered:missing-target": 0,
  "op.buffered:missing-membership": 0,
  "op.flushed": 0,
  "op.duplicate": 0,
});

export const createHistogramState = (name: HistogramName): HistogramState => ({
  counts: new Array<number>(HISTOGRAM_BOUNDS[name].length + 1).fill(0),
  sum: 0,
  count: 0,
});

export const recordHistogram = (
  name: HistogramName,
  state: HistogramState,
  value: number,
) => {
  if (!Number.isFinite(value) || value < 0) return;
  const bounds = HISTOGRAM_BOUNDS[name];
  let slot = 0;
  while (slot < bounds.length && value > bounds[slot]!) slot++;
  state.counts[slot]!++;
  state.sum += value;
  state.count++;
};

export const snapshotHistogram = (
  name: HistogramName,
  state: HistogramState,
): HistogramSnapshot => ({
  bounds: HISTOGRAM_BOUNDS[name],
  counts: [...state.counts],
  sum: state.sum,
  count: state.count,
});

export const bumpCounter = (counters: Counters, name: string) => {
  if (!Object.hasOwn(counters, name)) return;
  counters[name as CounterName]++;
};

export const recordSample = (
  histograms: Record<HistogramName, HistogramState>,
  name: string,
  value: number,
) => {
  if (!Object.hasOwn(histograms, name)) return;
  recordHistogram(
    name as HistogramName,
    histograms[name as HistogramName],
    value,
  );
};

export const createHistograms = (): Record<HistogramName, HistogramState> => ({
  "membership.join_ms": createHistogramState("membership.join_ms"),
  "consensus.round_ms": createHistogramState("consensus.round_ms"),
  "sync.catchup_ms": createHistogramState("sync.catchup_ms"),
  "buffer.wait_ms": createHistogramState("buffer.wait_ms"),
});

const zero = () => 0;

export const createGaugeGetters = (): GaugeGetters => ({
  "doc.nodes": zero,
  "doc.visible_length": zero,
  "doc.tombstones": zero,
  "buffer.depth": zero,
  "membership.peers": zero,
  "membership.version": zero,
  "membership.joined": zero,
  "status.current:connecting": zero,
  "status.current:joining": zero,
  "status.current:syncing": zero,
  "status.current:ready": zero,
  "status.current:reconnecting": zero,
  "status.current:disconnected": zero,
  "transport.current:connecting": zero,
  "transport.current:open": zero,
  "transport.current:closed": zero,
  "transport.current:backoff": zero,
});

export const adoptGaugeGetters = (
  getters: GaugeGetters,
  supplied: Partial<Record<string, unknown>>,
) => {
  for (const name of Object.keys(getters) as GaugeName[]) {
    if (!Object.hasOwn(supplied, name)) continue;
    const getter = supplied[name];
    if (typeof getter === "function") getters[name] = getter as () => number;
  }
};

export const snapshotGauges = (getters: GaugeGetters): GaugeValues => {
  const values = {} as GaugeValues;
  for (const name of Object.keys(getters) as GaugeName[]) {
    try {
      const value = getters[name]();
      values[name] = Number.isFinite(value) ? value : 0;
    } catch {
      values[name] = 0;
    }
  }
  return values;
};
