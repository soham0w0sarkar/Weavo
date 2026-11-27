import type { BufferObserver, BufferReason } from "@weavo/sync";
import type { TelemetryCounterName, WeavoTelemetryHook } from "./telemetry";

// One literal per reason, so counting an op never builds a string. A reason
// added in @weavo/sync without a matching telemetry name fails to compile.
const BUFFERED: {
  [R in BufferReason]: TelemetryCounterName & `op.buffered:${R}`;
} = {
  "missing-origin": "op.buffered:missing-origin",
  "missing-target": "op.buffered:missing-target",
  "missing-membership": "op.buffered:missing-membership",
};

export const createBufferObserver = (
  telemetry: WeavoTelemetryHook,
): BufferObserver => ({
  buffered: (reason) => telemetry.count(BUFFERED[reason]),
  duplicate: () => telemetry.count("op.duplicate"),
  released: (waitedMs) => {
    telemetry.count("op.flushed");
    telemetry.record("buffer.wait_ms", waitedMs);
  },
});
