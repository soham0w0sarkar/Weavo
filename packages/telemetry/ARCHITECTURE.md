# `@weavo/telemetry` — Internal Architecture

Design specification for `@weavo/telemetry`: dependency boundaries, hook seams, O(1) metric structures, and cardinality rules.

---

## 1. Non-negotiable constraints

1. **Strictly opt-in:** Apps using `@weavo/client` without `@weavo/telemetry` pay **0 B** of extra bundle size, **0** runtime dependencies, and **0** per-keystroke allocations.
2. **Zero runtime dependencies:** `@weavo/telemetry` uses `import type` only against `@weavo/client` / `@weavo/transport` (and structural interfaces for OpenTelemetry), so it never forces version lockstep or pulls heavy SDKs into the browser.
3. **Never touch `WIRE_VERSION = 3`:** Telemetry must not add fields or send-timestamps to binary CRDT frames.
4. **Bounded O(1) memory:** No unbounded sample arrays on clients, and no unbounded room/origin label maps on relays.

---

## 2. Subpath layout

Separate entrypoints prevent browser bundlers from pulling server exposition code (and vice versa):

```
packages/telemetry/src/
├─ index.ts              # createClientTelemetry, core Counter / Histogram primitives, types
├─ client/
│  ├─ clientTelemetry.ts # implements WeavoTelemetryHook + snapshot/flush lifecycle
│  └─ wrapTransport.ts   # RawTransport byte/tag inspector
├─ relay/
│  └─ relayTelemetry.ts  # connection, room fan-out, bufferedAmount & origin-reject metrics
└─ exporters/
   ├─ prometheus.ts      # Prometheus text exposition serializer (0.0.4)
   ├─ otel.ts            # structural adapter for @opentelemetry/api MeterLike
   └─ console.ts         # structured dev logger
```

---

## 3. Two-seam client collection

### Seam A — Wire wrapper (`wrapTransport`)

Wraps `RawTransport` (`send(Uint8Array)`, `onMessage`, `onOpen`, `onClose`) before `createTransport` sees it.

Because `@weavo/transport` frames start with `[WIRE_VERSION, msgTag, subtypeTag?]`, `wrapTransport` classifies traffic in **O(1) by reading at most 3 bytes** — zero payload deserialization:

- `bytesOut` / `bytesIn` and `framesOut` / `framesIn` partitioned by category (`op`, `sync_request`, `sync_response`, `membership_consensus`, `heartbeat`)
- Socket `connectCount`, `disconnectCount`, and `disconnectedDurationMs`

### Seam B — Semantic hook (`WeavoTelemetryHook` in `@weavo/client`)

Wrappers cannot see inside the CRDT replica, dependency buffer, or responder timer. `@weavo/client` exposes a tiny optional structural contract on `WeavoOptions`:

```ts
export type WeavoTelemetryEvent =
  | { type: "op.buffered"; reason: "causal" | "membership" }
  | { type: "op.flushed"; count: number; waitMs?: number }
  | { type: "op.duplicate" }
  | { type: "sync.request_sent" }
  | { type: "sync.response_sent"; ops: number; recipients: number }
  | { type: "sync.suppressed"; coveredOps: number }
  | { type: "gc.sweep"; removed: number; remainingCandidates: number }
  | { type: "membership.join_start" }
  | { type: "membership.joined"; durationMs: number; version: number }
  | { type: "membership.prepare_retry"; epoch: number }
  | {
      type: "membership.peer_evicted";
      reason: "suspect" | "expired" | "leave";
    };

export type WeavoInspector = {
  getNodeCount: () => number;
  getVisibleLength: () => number;
  getBufferedCount: () => number;
  getPeerCount: () => number;
  getMembershipVersion: () => number;
  isJoined: () => boolean;
};

export type WeavoTelemetryHook = {
  attach?: (inspector: WeavoInspector) => (() => void) | void;
  onEvent?: (event: WeavoTelemetryEvent) => void;
};
```

- **Push (`onEvent`)** fires only on state transitions and anomalies.
- **Pull (`attach`)** evaluates `doc.store.nodes.size`, tombstone ratio (`nodeCount - 1 - visibleLength`), and buffer depth **lazily when `telemetry.snapshot()` runs** — never on the hot typing loop.

---

## 4. Clock discipline

Following the root `ARCHITECTURE.md` two-clock rule:

- **All durations use monotonic `performance.now()` on a single machine:**
  - `joinLatencyMs`: `membership.join_start` → `membership.joined`
  - `syncCatchupMs`: outbound `sync-request` → matching `sync-response` applied (or buffer drained to `0`)
  - `bufferWaitMs`: op parked in `OperationBuffer` → flushed into `apply`
- **Never compute `Date.now() - senderTimestamp` across peers.** If end-to-end relay RTT is needed, measure round-trip time on causal request/response pairs (`JOIN_REQUEST → JOIN_RESPONSE`, `sync-request → sync-response`).

---

## 5. O(1) metric primitives

Every metric instance allocates fixed-size typed arrays at creation time:

- **Counters:** monotonic `Float64` integers (`opsBuffered`, `opsDuplicate`, `syncSuppressed`, `gcRemovedNodes`, `bytesIn`, `bytesOut`, `prepareRetries`).
- **Pull Gauges:** computed on `snapshot()` (`liveLength`, `tombstoneCount`, `bufferDepth`, `peerCount`, `isJoined`).
- **Fixed-bucket Histograms:** `Uint32Array(bounds.length + 1)` + `sum` + `count` + `min` + `max`.
  - Default latency bounds (ms): `[1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000]`
  - Default byte/fan-out bounds (relay): `[64, 256, 1_024, 4_096, 16_384, 65_536, 262_144, 1_048_576]`
  - Maps directly to Prometheus `_bucket{le="..."}` and OpenTelemetry explicit bucket histograms without retaining raw samples.

---

## 6. Relay telemetry & cardinality safety (`@weavo/telemetry/relay`)

The relay (`apps/weavo-server`) forwards opaque bytes and accepts arbitrary `?room=<id>` query strings and `Origin` headers from the public internet.

### Cardinality rule

**Never index metric series by `room` or `origin`.** A single script opening `100,000` random `?room=<uuid>` URLs would exhaust server RAM if `room` were a Prometheus/OTel label.

Instead, `createRelayTelemetry()` tracks global aggregates and distributions:

- `weavo_relay_connections_active` (gauge) & `weavo_relay_connections_total` (counter)
- `weavo_relay_rooms_active` (gauge) & `weavo_relay_room_peers` (histogram of room sizes on scrape)
- `weavo_relay_messages_in_total`, `weavo_relay_messages_fanned_out_total`, `weavo_relay_bytes_in_total`, `weavo_relay_bytes_out_total`
- `weavo_relay_fanout_recipients` (histogram per broadcast)
- `weavo_relay_socket_buffered_bytes` (histogram + counter of frames sent while `peer.bufferedAmount > backpressureWarnBytes`, catching slow-consumer memory buildup)
- `weavo_relay_rejected_upgrades_total` (counter, fixed enum `reason="origin" | "method"` only)
