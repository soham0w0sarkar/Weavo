export type BufferReason =
  | "missing-origin"
  | "missing-target"
  | "missing-membership";
export type EvictReason = "suspect" | "expired" | "leave";
export type TransportState = "connecting" | "open" | "closed" | "backoff";
export type ClientStatus =
  | "connecting"
  | "joining"
  | "syncing"
  | "ready"
  | "reconnecting"
  | "disconnected";

export type JoinOutcome =
  | "joined"
  | "founded"
  | "cancelled"
  | "timeout"
  | "failed";
export type ConsensusOutcome =
  | "committed"
  | "preempted"
  | "cancelled"
  | "timeout";
export type SyncOutcome =
  | "complete"
  | "cancelled"
  | "timeout"
  | "stalled"
  | "failed";

type NoDetails = Record<string, never>;

export type TelemetryEventDetails = {
  "transport.state": {
    state: TransportState;
    attempt: number;
    delayMs?: number;
  };
  "status.change": { status: ClientStatus };
  "join.end": { outcome: JoinOutcome; durationMs: number; version?: number };
  "consensus.retry": { version: number; epoch: number };
  "consensus.end": {
    outcome: ConsensusOutcome;
    durationMs: number;
    version: number;
    carriedForward: boolean;
  };
  "sync.end": { outcome: SyncOutcome; durationMs: number };
  "sync.request_sent": NoDetails;
  "sync.response_sent": { ops: number; recipients: number };
  "sync.suppressed": { coveredOps: number };
  "sync.chunk": { ops: number };
  "sync.claim": NoDetails;
  "sync.takeover": NoDetails;
  "sync.stall": NoDetails;
  "peer.evicted": { reason: EvictReason };
  "gc.sweep": { removed: number; candidates: number };
  "buffer.cap_hit": { depth: number; cap: number };
  "membership.fork": {
    version: number;
    localFingerprint: number;
    remoteFingerprint: number;
    localSize: number;
    remoteSize: number;
  };
};

type OpenStringFields<T> = {
  [E in keyof T]: {
    [F in keyof T[E]]-?: string extends T[E][F]
      ? `${E & string}.${F & string}`
      : never;
  }[keyof T[E]];
}[keyof T];

type Assert<T extends true> = T;

type DetailsAreClosed = Assert<
  [OpenStringFields<TelemetryEventDetails>] extends [never]
    ? true
    : OpenStringFields<TelemetryEventDetails>
>;

export type TelemetryEventName = keyof TelemetryEventDetails;

export type TelemetryCounterName =
  | `op.buffered:${BufferReason}`
  | "op.flushed"
  | "op.duplicate";

export type TelemetryHistogramName = "buffer.wait_ms";

export type TelemetryGaugeName =
  | "doc.nodes"
  | "doc.visible_length"
  | "doc.tombstones"
  | "buffer.depth"
  | "membership.peers"
  | "membership.version"
  | "membership.joined"
  | `status.current:${ClientStatus}`
  | `transport.current:${TransportState}`;

export type TelemetryGauges = Record<TelemetryGaugeName, () => number>;

export type WeavoTelemetryHook = {
  version: number;
  count: (name: TelemetryCounterName) => void;
  event: <K extends TelemetryEventName>(
    name: K,
    details: TelemetryEventDetails[K],
  ) => void;
  record: (name: TelemetryHistogramName, value: number) => void;
  attach: (gauges: Partial<TelemetryGauges>) => void;
};

// Bump when a name is renamed or removed, or a detail changes meaning.
// Adding a new name is not breaking: collectors ignore names they don't know.
export const TELEMETRY_HOOK_VERSION = 1 as const;

const MAX_HOOK_FAILURES = 3;

const NOOP_HOOK: WeavoTelemetryHook = {
  version: 0,
  count: () => {},
  event: () => {},
  record: () => {},
  attach: () => {},
};

export const isTelemetryAttached = (hook: WeavoTelemetryHook): boolean =>
  hook !== NOOP_HOOK;

export const createTelemetry = (
  hook?: WeavoTelemetryHook | null,
): WeavoTelemetryHook => {
  if (!hook) return NOOP_HOOK;

  if (hook.version !== TELEMETRY_HOOK_VERSION) {
    console.warn(
      `@weavo/client: telemetry hook version ${hook.version} does not match ${TELEMETRY_HOOK_VERSION}; telemetry is disabled`,
    );
    return NOOP_HOOK;
  }

  let target = hook;
  let failures = 0;

  const failed = () => {
    failures++;
    if (failures >= MAX_HOOK_FAILURES) target = NOOP_HOOK;
  };

  return {
    version: hook.version,
    count: (name) => {
      try {
        target.count(name);
      } catch {
        failed();
      }
    },
    event: (name, details) => {
      try {
        target.event(name, details);
      } catch {
        failed();
      }
    },
    record: (name, value) => {
      try {
        target.record(name, value);
      } catch {
        failed();
      }
    },
    attach: (gauges) => {
      try {
        target.attach(gauges);
      } catch {
        failed();
      }
    },
  };
};
