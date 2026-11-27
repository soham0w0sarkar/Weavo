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
├─ relay.ts              # entry for "@weavo/telemetry/relay" (server only)
├─ relay/
│  └─ relayTelemetry.ts  # connection, room fan-out, backpressure & origin-reject metrics
└─ exporters/
   ├─ families.ts        # shared MetricFamily model and histogram bucket samples
   ├─ prometheus.ts      # Prometheus text exposition serializer (0.0.4) + client snapshot mapping
   ├─ otel.ts            # structural adapter for an OpenTelemetry MeterLike
   └─ console.ts         # structured dev logger
```

---

## 3. Two-seam client collection

### Seam A — Wire wrapper (`wrapTransport`)

Wraps `RawTransport` (`send(Uint8Array)`, `onMessage`, `onOpen`, `onClose`) before `createTransport` sees it.

Because `@weavo/transport` frames start with `[WIRE_VERSION, msgTag, subtypeTag?]`, `wrapTransport` classifies traffic in **O(1) by reading at most 3 bytes** — zero payload deserialization:

- `bytesOut` / `bytesIn` and `framesOut` / `framesIn` partitioned by category (`op`, `sync_request`, `sync_response`, `membership_consensus`, `heartbeat`)
- Socket `connectCount`, `disconnectCount`, and `disconnectedDurationMs`

### Seam B — Semantic hook (`@weavo/client` → collector)

Wrappers cannot see inside the CRDT replica, dependency buffer, or responder timer, so `@weavo/client` reports through a hook: an object with five members. The hook type (`WeavoTelemetryHook`) and every metric name live in `@weavo/client` as types only, so the client never depends on this package. This package imports those types.

| Member                 | Use for                                                                                            | Allocates                          |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `version`              | A number the client checks before using the hook                                                   | nothing                            |
| `count(name)`          | Per-op counters: `op.buffered:*`, `op.flushed`, `op.duplicate`. Name only.                         | nothing                            |
| `event(name, details)` | Rare transitions: ends of joins, consensus rounds and syncs, retries, evictions, sweeps, anomalies | one small object, off the hot path |
| `record(name, value)`  | Per-op numbers: `buffer.wait_ms` only                                                              | nothing                            |
| `attach(gauges)`       | Called once at startup with the getters the client has (any subset)                                | nothing per call                   |

Gauges are never pushed. The client builds the getters and the collector calls them when `snapshot()` runs. Until `attach()` runs, and for any gauge the client does not supply, the snapshot reports `0`. A getter that throws or returns a non-finite number also reads as `0`, so one bad gauge cannot break a snapshot.

`createClientTelemetry()` returns `{ hook, snapshot }`. The collector can be driven by hand with no client at all: call `hook.count`, `hook.event` and `hook.record`, then read `snapshot()`. `test/clientTelemetry.test.ts` does exactly that.

### Client-side helper

Inside `@weavo/client` the hook is wrapped by `createTelemetry(hook?)` (`src/telemetry.ts`, internal, not exported from the package):

- **No hook means no-op.** It returns a shared empty hook with `version: 0`, so call sites are uniform and never check for `undefined`.
- **A different version means no-op.** `createTelemetry` compares `hook.version` with `TELEMETRY_HOOK_VERSION`. If they differ it logs one warning, does not attach, and uses the no-op.
- **It never breaks editing.** Every call is wrapped in `try/catch` and a throw is swallowed.
- **It gives up for good.** After 3 failures, counted across all five members together, it switches to the no-op and stops calling the hook.
- **Allocation rule.** Hot paths call `count(name)` with a literal and nothing else. Only rare events build a details object.

### Hook version

`TELEMETRY_HOOK_VERSION` is one constant, defined next to the hook types in `@weavo/client` (`src/telemetry.ts`). This package never reads it at runtime. It pins the number it was written for in `src/client/version.ts`:

```ts
export const HOOK_VERSION = 1 satisfies typeof TELEMETRY_HOOK_VERSION;
```

The collector's hook carries `HOOK_VERSION` as `version`. If the client's constant moves on, this line stops compiling, so the collector cannot be rebuilt against a contract it was not written for. If a mismatched pair is installed anyway, the client's check turns telemetry off. Reading the client's constant at runtime instead would always match and the check would never fire.

| Change                                            | Breaking | Version |
| ------------------------------------------------- | -------- | ------- |
| Rename or remove a name                           | yes      | bump    |
| Change what a detail means                        | yes      | bump    |
| Add a new name (counter, event, gauge, histogram) | no       | keep    |
| Add a new value to a label (an outcome, a reason) | no       | keep    |

Adding is only safe because the collector ignores names it does not know. `bumpCounter` and `recordSample` drop an unknown name instead of throwing or creating a `NaN` entry, so an older collector can run with a newer client. A removed counter or histogram would keep its value at zero, which is why removing is a bump.

---

## 4. Counting rules

One rule per metric kind, so nothing is counted twice.

1. **An event bumps its own counter, automatically.** The collector increments the counter with the event's name, plus the detail when the counter has one (`join.end:timeout`, `sync.end:stalled`, `peer.evicted:suspect`, `transport.state:backoff`). The client never also calls `count()` for something it already sends as an event.
2. **`count()` is only for hot counters.** `TelemetryCounterName` is the closed list the client may pass to `count()`: `op.buffered:*`, `op.flushed` and `op.duplicate`. Counters that need an amount, such as nodes removed by GC, are not hot counters; the amount rides on the event (`gc.sweep` carries `removed`). The compiler rejects an event name passed to `count()`.
3. **Events are not stored.** They arrive, bump a counter, maybe feed a histogram, and are dropped. The snapshot has no event field.
4. **The routing table is written once, in the collector.** See below. The client knows nothing about counters or histograms.
5. **Every counter exists from the start.** `createCounters()` returns all names at `0`, and its return type is `Counters`, so adding a name to the union without adding it there is a compile error. A snapshot never has a missing key, so graphs have no gaps.
6. **Detail values are numbers, booleans, or fixed words.** No free-form strings, so nothing in an event can carry an id or a name. `DetailsAreClosed` in `types.ts` fails to compile if any detail field is a plain `string`. `membership.fork` carries the version, a numeric fingerprint of each side's table, and each side's size: it says a fork exists, not who is in it.

### Two state machines, two names

- **Transport state** (`transport.state` event): `connecting | open | closed | backoff`. What the socket is doing.
- **Client status** (`status.change` event): `connecting | joining | syncing | ready | reconnecting | disconnected`. The user-facing machine.

They never share a name. How often each transition happened is the counter (`transport.state:open`, `status.change:ready`). What the state is right now is a gauge, one per state: `status.current:ready` is `1` when the client is ready and `0` otherwise, and the same for `transport.current:*`. Exactly one gauge in each family is `1`.

### Why an op is buffered

`op.buffered:<reason>` has three reasons, matching `@weavo/sync`:

- `missing-origin`: an insert whose `leftOrigin` or `rightOrigin` has not arrived.
- `missing-target`: a delete whose target insert has not arrived.
- `missing-membership`: any op still carrying an unresolved shortId. This wins over the other two when both apply.

### Where the buffer reports

`@weavo/sync` has no idea telemetry exists. `createBuffer(observer?)` takes an optional `BufferObserver` with three members: `buffered(reason)`, `released(waitedMs)` and `duplicate()`. `@weavo/client` builds one from the hook (`src/bufferTelemetry.ts`) only when a hook is attached, mapping each reason to a literal counter name.

- **`op.buffered:<reason>`** fires once, when an op first enters the buffer. An op that is re-placed while draining, or re-keyed after its membership version arrives, is not counted again.
- **`op.flushed` and `buffer.wait_ms`** fire together when a buffered op is finally applied. The wait is `performance.now()` at release minus the timestamp taken when it was buffered. The timestamp survives a membership re-key.
- **`op.duplicate`** fires from two places: the client when an arriving op is already in the document, and the buffer when an arriving op is already waiting in it.
- **No hook, no cost.** With no observer the buffer takes no timestamps and `since` stays empty.
- **Invariant.** `op.buffered:* - op.flushed` equals the `buffer.depth` gauge.
- **Not counted:** ops replayed by `loadDocument` that are already present. They are not network duplicates.

Gauges wired so far: `buffer.depth` (size of the buffered inserts plus pending deletes) and `doc.nodes` (size of the node store). Both are map-size lookups.

### Sync events

These fire from `manageTransport` in `@weavo/client`. The collector needs no new code: the routing table already maps each one.

| Event                | Fires when                                                                                 | Details             |
| -------------------- | ------------------------------------------------------------------------------------------ | ------------------- |
| `sync.request_sent`  | A `sync-request` is actually sent (the socket is open and the client has joined)           | none                |
| `sync.response_sent` | This client sends a `sync-response` after its random delay                                 | `ops`, `recipients` |
| `sync.suppressed`    | A response we planned is dropped because a peer's response already covered every op needed | `coveredOps`        |
| `sync.end:complete`  | A response addressed to this client arrived and was applied                                | `durationMs`        |

- **One response is the signal.** The protocol has no message for "nothing to send", so a request that finds nothing missing gets no reply. Because of that, only `complete` is reported. `timeout`, `cancelled`, `stalled` and `failed` are in the contract but are not emitted, since a lost reply and an up-to-date peer look the same.
- **Duration is per request.** The clock restarts on every request sent, so an unanswered request never inflates a later catch-up. It is reset when the transport closes, so offline time is never counted.
- **`sync.catchup_ms` therefore means** the time from the latest request to the response that carried data, not the time to be fully in sync.
- **Suppression is per requester.** Each planned response that is cancelled counts once, with the number of ops that made it unnecessary. A request that was already empty is not counted.

### Routing table

`EVENT_ROUTES` in `src/client/routes.ts` maps every event name to what the collector does with it:

| Field       | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `label`     | A string detail added to the counter name, as in `peer.evicted:suspect` |
| `histogram` | Which histogram to feed, and from which numeric detail field            |

```ts
"join.end": {
  label: "outcome",
  histogram: { name: "membership.join_ms", field: "durationMs" },
},
"peer.evicted": { label: "reason" },
"sync.chunk": {},
```

The table is checked against the contract at compile time. A missing event, a `label` that is not a string detail, or a `field` that is not a number is a build error. The counter-name union (`EventCounterName`) is derived from the table, so the counters and the table cannot disagree.

`applyEvent` is the only code that reads the table. An unknown event name is ignored, an unknown label value bumps nothing, and a missing or non-numeric duration records no histogram sample.

### End events carry the duration

`join.end`, `consensus.end` and `sync.end` each carry `durationMs`, measured by the client with its own timer. There are no start events, so there is nothing to pair, nothing to leak, and no limit on open flows to enforce. The client takes one timestamp when a join, round or sync begins; these are rare, so the cost is negligible.

Every outcome feeds the histogram, failures included. The counter label (`sync.end:timeout`) separates them. The OTel adapter can build a span afterwards from the end event, with its start set to now minus `durationMs`.

`buffer.wait_ms` is per op, not per event, so it is fed by `record()`. The buffer remembers when each op was parked, but only while a collector is attached.

---

## 5. Clock discipline and metric primitives

All durations use monotonic `performance.now()` on one machine. Never compute `Date.now() - senderTimestamp` across peers; measure round trips on request/response pairs instead.

- **Counters:** plain numbers keyed by the closed `CounterName` union.
- **Gauges:** getters in internal state (`GaugeGetters`), plain numbers in the snapshot (`GaugeValues`). The client builds the getters and passes them to `attach()`. `doc.visible_length` reads the skip list's maintained `length`, never the rebuilt text, and `doc.tombstones` is `nodes - 1 - visible_length`, so both are O(1).
- **Histograms:** internal state is `{ counts, sum, count }` with boundaries kept in one shared constant (`HISTOGRAM_BOUNDS`). The snapshot carries `bounds` next to `counts`. `createHistogramState` allocates `bounds.length + 1` slots; the last holds values above the largest bound. A value goes in the first slot whose bound it does not exceed. Counts are non-cumulative and only made cumulative when exporting to Prometheus `_bucket{le="..."}`. Negative and non-finite values are ignored.
  - The event histograms (join, consensus, sync) use `1 ms` to `10 s` bounds.
  - `buffer.wait_ms` uses finer low bounds, `0.5 ms` to `1 s` in powers of two, since most waits are a few milliseconds.

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
- `weavo_relay_backpressured_frames_total` (counter of frames sent while `peer.bufferedAmount > backpressureWarnBytes`, catching slow-consumer memory buildup). A per-socket buffered-bytes histogram is deferred until the Bun websocket buffered-amount API is verified.
- `weavo_relay_rejected_upgrades_total` (counter, fixed enum `reason="origin" | "method"` only)

---

## 7. Exporters

Every exporter reads one shared model, `MetricFamily[]`, so Prometheus and OpenTelemetry cannot drift apart.

- **Prometheus** (`formatPrometheus`): text format 0.0.4. Writes `HELP` and `TYPE` per family, escapes label values, and writes `+Inf` for the last bucket.
- **Client mapping** (`clientFamilies`): counters become `weavo_client_<base>_total`, with the detail as a label (`op.buffered:missing-origin` becomes `reason="missing-origin"`). Gauges keep their names, and the `status.current:*` and `transport.current:*` families are one-hot with a `status` or `transport` label. Histograms become `_bucket{le}`, `_sum` and `_count`.
- **OpenTelemetry** (`bindOtel`): registers one observable instrument per sample name, using a structural `MeterLike`, so `@opentelemetry/api` is not imported. Callbacks read the current families on each collection. Histogram buckets are sent as observable counters with an `le` attribute, because OTel's histogram instrument cannot take pre-accumulated bucket counts.

Client numbers reach a backend by push, not scrape, because browsers have no address to scrape. `startOtlpPush(source, { url })` posts the snapshot as OTLP/HTTP JSON every 5 s. Counters and histograms are cumulative, and each page load gets its own `service.instance.id`. A push that fails is dropped, and the next one carries the full state. The local stack lives in `infra/telemetry`: an OpenTelemetry Collector receives the push, Prometheus scrapes the collector, and Grafana shows the `Weavo client` dashboard. The demo enables the push with `?telemetry=otel`. Telemetry starts when a room is opened.
