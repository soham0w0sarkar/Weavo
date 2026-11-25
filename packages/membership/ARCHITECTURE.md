# `@weavo/membership` — Internal Architecture

Internal consensus mechanics, quorum rules, and clock separation inside `@weavo/membership`. For public exports and usage, see [`README.md`](./README.md).

---

## 1. Deterministic `shortId` snapshots (`src/membershipStore/`)

A `Membership` is an immutable value `(version, members)`. `buildMembership(version, clientIds)` deduplicates `clientIds`, sorts them with standard lexicographic string order, and assigns `shortId = index` (`0 .. n-1`).

- **Invariants:**
  1. Two peers holding the same `version` are guaranteed identical `shortId ↔ ClientId` mappings.
  2. Joins and leaves never mutate an existing version in place; they propose `version + 1`.
  3. `MembershipStore` retains **all historical committed versions** in `Map<number, Membership>` so in-flight CRDT ops encoded under `version - 1` still decode cleanly after `version` commits.

---

## 2. Broadcast CASPaxos consensus (`src/consesous/`)

Classic Paxos assumes point-to-point messaging and a stable leader. Weavo runs over a dumb broadcast relay, so every joined peer runs both a `Proposer` and an `Acceptor` over the shared room channel.

### Ballot total order (`Ballot.ts`)

A `Ballot` is `{ epoch: number, proposer: ClientId }`. `compareBallot(a, b)` orders by:

1. Higher `epoch` wins (`a.epoch - b.epoch`).
2. Tie-breaker on equal `epoch`: **lexicographically smaller `proposer` UUID wins** (`a.proposer < b.proposer` → `+1`). That aligns with `shortId` rank `0` having highest priority.

`nullBallot()` is `{ epoch: -1, proposer: "" }`, which loses to every real ballot.

### Contention avoidance & batching (`Proposer.ts`)

Because every peer sees `JOIN_REQUEST` / `LEAVE` simultaneously, naive proposers would duel on every membership change. `scheduleProposal` staggers proposers deterministically:

```
delay = max(0, rank) * 500ms + uniform(0..100ms) + 200ms (BATCH_WINDOW)
```

- `rank` is the peer's index in `currentMembership.members` (`shortId = 0` fires after ~200–300ms; rank `1` waits ~700–800ms; etc.).
- During `BATCH_WINDOW`, concurrent `JOIN_REQUEST` and `LEAVE` messages accumulate in `joinReqBatch` and `leaveReqBatch` (a `JOIN_REQUEST` cancels a pending `LEAVE` for the same ID and vice versa).
- Usually rank `0` commits and broadcasts `COMMIT` before rank `1`'s `proposalTimer` even fires; `COMMIT` calls `proposer.cancel()` on every peer.

### Solo founding & simultaneous cold-start (`membership.ts`)

When a room is empty (`current.members.length === 0`), a joining peer isn't `joined` yet (`canRunConsensus()` requires `joined || founding`):

- **Solo joiner:** `requestJoin` starts `foundingTimer` (`foundingGraceMs`, default `750ms`). If no existing room answers with `COMMIT` / `JOIN_RESPONSE`, `beginFounding` flips `founding = true` and proposes `[self]` at `version = 1` with quorum `1`.
- **Two peers hitting an empty room at once:** Receiving another peer's `JOIN_REQUEST` while `empty && !joined` immediately calls `beginFounding(self)` and batches the peer's `JOIN_REQUEST`, avoiding a 750ms stall and converging both founders via ballot tie-breaking + carry-forward.

### Carry-forward rule (`Proposer.onPromise`)

Each `version` is a separate single-decree consensus slot (`promisedBallots`, `acceptedBallots`, and `acceptedMemberships` in `Acceptor.ts` are keyed by `msg.version`):

1. `Acceptor.onPrepare`: rejects if `msg.ballot < promisedBallots[version]`; otherwise records promise and returns `PROMISE` carrying `(lastAcceptedBallot, lastAcceptedMembership)` for that `version`.
2. `Proposer.onPromise`: once `promises.size >= quorum()` (and `!acceptSent`):
   - Inspects all collected promises for `lastAcceptedBallot !== null`.
   - **Carry-forward:** if any acceptor already accepted a value for `version`, the proposer **must** adopt `lastAcceptedMembership` from the highest `lastAcceptedBallot` instead of its own `proposedMembership`. This prevents split-brain overwrites when a retry preempts an almost-committed round.
   - Sets `acceptSent = true` so trailing `PROMISE` messages never emit duplicate `ACCEPT`s.
3. `Proposer.onAccepted`: once `acceptances.length >= quorum()`, broadcasts both `COMMIT` (clears acceptor ballot state and installs `proposed`) and `JOIN_RESPONSE` (wakes waiting joiners), then resets proposer state.
4. **Prepare retry:** if quorum isn't reached within `PREPARE_TIMEOUT (2000ms) + uniform(0..500ms)`, `startProposal(proposed, true)` increments `epoch` and re-runs `PREPARE`.

### Local-first `outbound` loop (`membership.ts`)

`outbound(message)` calls `handle(message)` **synchronously before** `broadcast(message)`:

- A proposer counts its own `PREPARE → PROMISE` and `ACCEPT → ACCEPTED` votes without round-tripping through the relay.
- `COMMIT` updates `store.currentVersion` locally _before_ the frame hits the wire, guaranteeing any immediate post-commit frame uses the committed table.

---

## 3. Post-removal quorum math

If a 2-peer room required `floor(2/2) + 1 = 2` votes to remove a crashed peer, the surviving peer could never reach quorum alone. `quorum()` (`Proposer.ts:50`) computes:

```ts
const count = proposed
  ? Math.min(current.members.length, proposed.members.length)
  : current.members.length;
return count === 0 ? 1 : Math.floor(count / 2) + 1;
```

- **Joins (`proposed > current`):** quorum uses `current.members.length` — existing members ratify newcomers.
- **Leaves/removals (`proposed < current`):** quorum uses `proposed.members.length` — departing/dead peers don't vote on their own exit.

### `revive()` vs `handleSelfRemoval()`

- **Before `COMMIT` (`revive`):** If a silent peer sends a `HEARTBEAT` while a proposal excluding them is still pending or in-flight, `proposer.revive(peerId)` strips them from `leaveReqBatch`, cancels the in-flight removal proposal, and re-queues any remaining batched joins/leaves.
- **After `COMMIT` (`handleSelfRemoval`):** If a partitioned peer returns and receives a `COMMIT` / `MEMBERSHIP_RESPONSE` that no longer lists `clientId`, it sets `joined = false`, stops heartbeats, clears local presence/liveness, and automatically calls `requestJoin(clientId)` to re-enter under a fresh `version` and `shortId`.

---

## 4. Presence, two-stage liveness & GC frontier (`src/presence/`)

### Two clocks (`presence.ts` & `liveness.ts`)

- `PresenceEntry.timestamp`: **sender's `Date.now()`** — used strictly for per-`clientId` LWW ordering (`entry.timestamp > existing.timestamp`). Immune to inter-machine clock skew because Alice's timestamps are only ever compared against Alice's earlier timestamps.
- `PresenceEntry.receivedAt` & `LivenessEntry.lastSeen`: **receiver's local `now()`** — used strictly for silence aging.
- `setCursor(clientId, cursor)`: mutates `cursor` in place **without** bumping `timestamp` or `receivedAt` (remote op nudges never masquerade as liveness proof or override the next heartbeat).

### Two-stage silence sweep (`liveness.ts`)

`applyLivenessSweep` runs on incoming heartbeats:

1. **`age >= presenceTimeoutMs` (default `10s`) → `suspected`:** peer disappears from `presence` (ghost cursor cleared in UI), but `Membership` table stays untouched so brief Wi-Fi drops don't churn `shortId` versions.
2. **`age >= removalTimeoutMs` (default `30s`) → `expired`:** triggers `queueRemoval(id)` → `LEAVE` consensus proposal.

Graceful `leave()` bypasses both timers: broadcasts `LEAVE`, which peers immediately drop from presence/liveness and feed into `proposer.onLeaveRequest`.

### `computeGCFrontier` (`gcFrontier.ts`)

Computes `frontier[author] = min(mySv[author], ...peer.sv[author])` across `presence.entries`:

- **Self-exclusion guard:** explicitly skips `entry.clientId === myClientId` (`outbound` loops our own `HEARTBEAT` into `presence`, and that cached heartbeat `sv` lags behind keys typed _since_ the last heartbeat).
- If a silent peer hasn't been evicted from `presence` yet, their older `sv` holds the frontier back; once suspected at `10s`, they leave `presence` and the frontier advances (protected by `@weavo/core`'s `30s` GC grace window).
