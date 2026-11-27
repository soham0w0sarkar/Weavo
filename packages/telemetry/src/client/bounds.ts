import type { HistogramName } from "./types";

const LATENCY_MS = [
  1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
] as const;

const WAIT_MS = [0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1_000] as const;

export const HISTOGRAM_BOUNDS: Record<HistogramName, readonly number[]> = {
  "membership.join_ms": LATENCY_MS,
  "consensus.round_ms": LATENCY_MS,
  "sync.catchup_ms": LATENCY_MS,
  "buffer.wait_ms": WAIT_MS,
};
