# Weavo — Architecture & Design Notes

System-level notes: package boundaries, cross-package handoffs, and rules that span more than one package.

- **Public API & usage** live in each package's `README.md` (shipped to npm).
- **Package-internal mechanics** live in `packages/<name>/ARCHITECTURE.md` when the internals warrant it (`core`, `membership`, `textarea-adapter`, `monaco-adapter`, `telemetry`). Small packages (`sync`, `transport`, `client`) are covered by this file and their `README.md`.

Rough roadmap (more "what the last problem forced" than a product plan):

- **v1** — Collaborative text editing
- **v2** — CRDT garbage collection (once we can trust who's still alive)
- **v3** — Higher-level collaborative primitives (shared objects, ProseMirror, …)

---

## Package map

```
@weavo/core               → packages/core/ARCHITECTURE.md
    ├─ YATA-style CRDT (node store)
    ├─ Ranked skip list (editor index ↔ op id)
    ├─ Operations, local input & snapshots
    └─ Physical tombstone GC + origin-reference guard

@weavo/sync
    ├─ State vectors & missing-op discovery
    ├─ Dependency + unresolved-membership buffer
    └─ Cascade flush on op / membership arrival

@weavo/transport
    ├─ Message types (op / sync / membership wire union)
    ├─ Versioned binary frames (`WIRE_VERSION = 3`)
    ├─ shortId / UUID id codec (sync path)
    ├─ Binary membership subtype codec (UUID ids)
    ├─ Snapshot / delta persistence codec (UUID-stable)
    └─ Reconnecting WebSocket `RawTransport`

@weavo/membership         → packages/membership/ARCHITECTURE.md
    ├─ Deterministic sorted UUID ↔ shortId snapshots
    ├─ Broadcast CASPaxos consensus (proposer / acceptor)
    ├─ JOIN_REQUEST → COMMIT → JOIN_RESPONSE join gate
    ├─ Presence (LWW) + two-stage liveness
    └─ GC frontier (min of peer SVs from heartbeats)

@weavo/client
    ├─ Document orchestration (replica, sync, transport, membership)
    ├─ Join gate + sync-response storm suppression
    ├─ IdCodec wired from membership into transport
    ├─ Tombstone GC scheduling on presence ticks
    └─ Editor-agnostic `WeavoAdapterHost` + optional telemetry hook

@weavo/textarea-adapter   → packages/textarea-adapter/ARCHITECTURE.md
    ├─ Native `<textarea>` bind & pre-input snapshot reconciliation
    ├─ Grapheme-aware deletes & selection transforms
    └─ IME composition isolation

@weavo/monaco-adapter     → packages/monaco-adapter/ARCHITECTURE.md
    ├─ Monaco model ↔ flat UTF-16 offset bridge
    ├─ Multi-selection transform & echo-free remote edits
    └─ IME composition isolation

@weavo/telemetry          → packages/telemetry/ARCHITECTURE.md
    ├─ Opt-in client & relay observability (zero runtime deps)
    ├─ `RawTransport` byte/tag wrapper + semantic client hooks
    └─ O(1) counters, pull gauges, fixed-bucket histograms & exporters

apps/weavo-server
    └─ Dumb relay — forwards opaque frames per room, zero protocol state
```

Rule we keep coming back to: **each package owns one concern.** If a change wants two packages rewritten for one idea, we drew the line wrong.

---

## First decision that wouldn't die: dumb relay

The relay (`apps/weavo-server`) only forwards opaque frames between sockets in the same room. No parsing ops, no document state, no membership coordinator. Correctness lives on the clients.

Porting the protocol to WebRTC mesh or another byte pipe means swapping `RawTransport` without touching CRDT, sync, or consensus logic. The cost is that every coordination problem — catch-up storms, wire compression, failure detection, GC — has to be solved peer-to-peer on a broadcast channel.

---

## Cross-package handoffs

### 1. Keystroke → wire → remote editor

1. **Adapter (`textarea-adapter` / `monaco-adapter`)** captures a UTF-16 `{ start, end, value }` snapshot and calls `host.applyLocal(input, snapshot)`.
2. **`@weavo/core`** (`onInput`) diffs the range into `delete` + `insert` CRDT operations, splices `NodeStore` and `SkipList`, and returns `{ op, index }[]`.
3. **`@weavo/client`** advances the local `StateVector` (for inserts) and hands `{ type: "op", op }` to `Transport`.
4. **`@weavo/transport`** encodes a `WIRE_VERSION = 3` binary frame, compressing known client UUIDs to 1–2 byte `shortId`s via `IdCodec` stamped with the current membership `version`.
5. **Receiver `@weavo/transport`** decodes against that `version`. If the receiver hasn't committed `version` yet, unknown `shortId`s decode as placeholder `~<version>:<shortId>` client IDs and trigger `requestMembership(version)`.
6. **`@weavo/sync` + `@weavo/client`** check `canApply`: ops missing causal origins or carrying `~<version>:<shortId>` park in `OperationBuffer`. Once origins or `MEMBERSHIP_RESPONSE` arrive, `flush` / `flushMembership` cascades ready ops into `apply(doc, op)`.
7. **Adapter** receives `onRemote({ op, index, change, text })` and updates the UI while transforming local selections (or deferring DOM writes if an IME composition is active).

### 2. Catch-up & `O(N²)` sync-response suppression

On socket open (once joined) and tab wake, `@weavo/client` broadcasts `{ type: "sync-request", vector, clientId }`. If a peer's `sync-request` carries clocks ahead of ours (`isAhead`), we also schedule our own debounced `sync-request` so sync converges in both directions.

With _N_ peers in a room, naive replies cause every up-to-date peer to dump the same catch-up history. `@weavo/client`'s responder suppresses duplicates without a server:

1. Queue incoming `sync-request` `clientId`s and arm a single timer on the first useful request.
2. Draw exponential delay inversely proportional to usefulness (`count = missingOps.length`):
   ```
   delay = -ln(U) / count     // U ~ Uniform(0, 1]
   ```
3. Winner broadcasts one batched `sync-response` covering `{ ops, clientIds: [...pending] }`.
4. Peers overhearing a `sync-response` mark covered ops per requester and cancel their own timer once nothing uncovered remains.

### 3. Why wire bloat forced `@weavo/membership`

Every insert carries up to three `(clientId, clock)` pairs (`id`, `leftOrigin`, `rightOrigin`). In JSON, UUID strings ate ~40–50% of every single-character frame and turned multi-thousand-op `sync-response` payloads into megabyte stalls.

Binary framing + `shortId`s (`0 .. n-1`) fix that, **provided every peer maps `(version, shortId)` to the exact same UUID**. Any disagreement decodes ops under the wrong author and silently forks the CRDT.

- Sync path (`op`, `sync-request`, `sync-response`): binary + `membershipVersion` + `shortId`s (UUID fallback pre-join).
- Membership path (`JOIN_*`, `PREPARE`…`COMMIT`, `HEARTBEAT`): always full 16-byte UUIDs — these frames build the table.
- Persistence path (`PERSIST_VERSION`): always full UUIDs — `shortId`s are room-version-local and must never hit disk.

See [`packages/membership/ARCHITECTURE.md`](packages/membership/ARCHITECTURE.md) for the CASPaxos state machine and quorum rules.

### 4. Tombstone GC across three packages

Deletes only set `tombstone = true` because concurrent inserts may still cite that node as `leftOrigin` / `rightOrigin`. Physical removal splits cleanly across three packages:

1. **`@weavo/membership`** piggybacks each peer's `StateVector` on `HEARTBEAT`s and computes `GCFrontier` — the per-author minimum clock across our live `sv` and all active presence peers.
2. **`@weavo/client`** triggers `sweepGC` when presence updates move the frontier (or candidates await grace), enforcing a 30s grace window aligned with membership removal timeout.
3. **`@weavo/core`** (`runGC`) unlinks eligible tombstones from `NodeStore` **only if no other node still references them as `leftOrigin` or `rightOrigin`**.

### 5. Observability without touching `WIRE_VERSION = 3`

`@weavo/telemetry` stays strictly opt-in through two seams:

- **Wire seam:** wraps `RawTransport` (`Uint8Array` frames) and inspects the leading frame/subtype tag bytes without double-decoding payloads.
- **Semantic seam:** `@weavo/client` exposes an optional structural telemetry hook (push events for buffer/responder/GC/consensus transitions + pull getters for gauges). When omitted, `@weavo/client` pays zero bundle bytes and zero allocations.

We deliberately never add wall-clock send timestamps to `WIRE_VERSION = 3` op frames: 8 bytes per keystroke fights `shortId` compression, and cross-device clock skew makes one-way wall-clock latency bogus anyway.

---

## Two clocks, two jobs (and a third for durations)

Across real networks, device wall clocks drift. Mixing clocks causes bugs that two tabs on `localhost` never reproduce (e.g., heartbeats arriving "already expired" and flickering remote cursors out of existence).

| Clock                     | Used for                                                     | Never used for                       |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------ |
| Sender `Date.now()`       | Ordering one peer's own `HEARTBEAT` writes (LWW `timestamp`) | Aging silence on another machine     |
| Receiver local clock      | Presence `receivedAt` eviction (~10s) & liveness `lastSeen`  | Comparing across different receivers |
| Local `performance.now()` | Telemetry RTTs, buffer wait time, apply/GC durations         | Cross-machine one-way op latency     |

Remote insert ops also nudge the author's caret locally (`membership.setCursor(author, index + 1)`) so carets don't lag typing between heartbeats. That nudge touches neither `timestamp` (sender remains LWW authority) nor `receivedAt` (an op is not a heartbeat).

---

## Key design question: whose package?

| Idea                                            | Home                      | Deep dive                                                                                |
| ----------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| Causal insert order & skip-list index           | `@weavo/core`             | [`packages/core/ARCHITECTURE.md`](packages/core/ARCHITECTURE.md)                         |
| State vectors & out-of-order op buffer          | `@weavo/sync`             | `packages/sync/README.md`                                                                |
| Binary wire frames, WTF-8, persistence codec    | `@weavo/transport`        | `packages/transport/README.md`                                                           |
| Member set, `shortId` table, CASPaxos, presence | `@weavo/membership`       | [`packages/membership/ARCHITECTURE.md`](packages/membership/ARCHITECTURE.md)             |
| Orchestration, sync suppression, GC scheduling  | `@weavo/client`           | `packages/client/README.md`                                                              |
| DOM `<textarea>` diffing, selection & IME       | `@weavo/textarea-adapter` | [`packages/textarea-adapter/ARCHITECTURE.md`](packages/textarea-adapter/ARCHITECTURE.md) |
| Monaco offsets, multi-cursor & echo guard       | `@weavo/monaco-adapter`   | [`packages/monaco-adapter/ARCHITECTURE.md`](packages/monaco-adapter/ARCHITECTURE.md)     |
| Counters, histograms, relay & client metrics    | `@weavo/telemetry`        | [`packages/telemetry/ARCHITECTURE.md`](packages/telemetry/ARCHITECTURE.md)               |
| Forward opaque bytes per room                   | `apps/weavo-server`       | —                                                                                        |

---

## Still open

- Delete ops still lack their own clocks — GC frontier is insert-SV based; grace + unreferenced-origin checks cover the live-delete race for now.
- Wire `@weavo/telemetry` hooks into `@weavo/client` and `apps/weavo-server` once the telemetry package implementation lands.
