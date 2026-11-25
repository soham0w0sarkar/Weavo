# `@weavo/core` — Internal Architecture

Internal data structures, invariants, and edge cases inside `@weavo/core`. For public exports and usage, see [`README.md`](./README.md).

---

## 1. Dual-structure replica invariant

A `Document` (`src/documents/types.ts`) holds two representations of the same character sequence:

| Structure   | File                       | Nodes inside                 | Primary lookup                            |
| ----------- | -------------------------- | ---------------------------- | ----------------------------------------- |
| `NodeStore` | `src/store/NodeStore.ts`   | Live nodes **+ tombstones**  | `Map<OperationKey, Node>` + `.next` links |
| `SkipList`  | `src/skipList/skipList.ts` | **Live nodes only** + `head` | Visible UTF-16 index ↔ `OperationKey`     |

Both structures start with a local `ROOT_ID` (`["ROOT", 0]`) sentinel (`NodeStore.root` and `SkipList.head`). `ROOT` is never emitted as an operation; inserts at index `0` use `ROOT_ID` as `leftOrigin`.

Every `apply(doc, op)` (`src/documents/apply.ts`) mutates both structures atomically:

- **Insert:** splice into `NodeStore` first, resolve visible position via `SkipList`, then insert into `SkipList` (`length++`).
- **Delete:** locate visible index in `SkipList`, mark `node.tombstone = true` in `NodeStore` (preserving causal history), and remove the node from `SkipList` (`length--`).

Each CRDT node stores **one UTF-16 code unit** (`value.length === 1`), matching JavaScript `string` indexing (`selectionStart`, Monaco offsets). Surrogate pairs occupy two adjacent CRDT nodes.

---

## 2. YATA / RGA sibling ordering (`NodeStore.insert`)

An `InsertOperation` carries `(id, value, leftOrigin, rightOrigin)`. Both origins must already exist in `nd.nodes` before `insert` is called (`@weavo/sync` enforces this via `canApply`).

When concurrent inserts share the same `leftOrigin`, `NodeStore.insert` (`src/store/NodeStore.ts`) scans forward from `leftOriginNode.next` up to `rightOriginNode` to place `op` deterministically without a central sequencer:

1. **Subtree containment (`isDescendantOf`):** If `scan` does not share `op.leftOrigin`, walk `scan.leftOrigin` chains upward.
   - If `scan` descends from `op.leftOrigin` (`nestedDeeper`), `scan` belongs to an earlier sibling's subtree — **keep scanning past it** so sibling subtrees never interleave.
   - If `scan` is neither `sameOrigin` nor `nestedDeeper` (`outsideRange`), we have exited the conflict window — **break and insert before `scan`**.
2. **Sibling tie-break (`compareOperationId` in `src/ids/compare.ts`):** When `scan.leftOrigin === op.leftOrigin`:
   - Compare logical clock `id[1]` first, then lexicographic `ClientId` `id[0]`.
   - Scan advances while `op.id > scan.id` and breaks when `compareOperationId(op.id, scan.id) < 0`. Larger IDs settle further right; every replica converges on the identical linked-list order regardless of arrival permutation.

---

## 3. Ranked skip list & span maintenance (`src/skipList/skipList.ts`)

Standard skip lists search by key; Weavo's skip list is ordered solely by **current document position** using Redis-style rank spans (`MAX_HEIGHT = 32`, geometric `P = 0.5`).

### Span invariant

At level `L`, `node.span[L]` equals the number of base-level (`level = 0`) steps from `node` to `node.next[L]` (or `0` when `next[L]` is `null` on a newly initialized tail edge, maintained relative to predecessor ranks). `head` sits at virtual rank `0`; the first visible character is `head.next[0]` (index `0`).

### `insert(sl, index, refCrdtId)` — **O(log n)**

1. `findPredecessor(sl, index)` walks top-down from `MAX_HEIGHT - 1` to `0`, recording at every level:
   - `update[level]`: rightmost node strictly preceding `index`
   - `rankAt[level]`: cumulative base-level rank reached at `update[level]`
2. Draw tower `height = randomHeight()`.
3. For `0 <= level < height`, split the predecessor's span across the new node:
   ```
   split             = index - rankAt[level]
   newNode.span[L]   = pred.span[L] - split
   pred.span[L]      = split + 1
   ```
4. For `height <= level < MAX_HEIGHT`, `newNode` does not reach this level, so `update[level].span[level]++` accounts for the extra visible character underneath its forward jump.

### `remove(sl, refCrdtId)` — **O(log n)** expected

1. Look up `target` in `sl.nodeMap` (`Map<OperationKey, SkipListNode>`).
2. `findPredecessorsOf(sl, target)` walks top-down using `isBetween(x, next, target)` to avoid overshooting `target` without needing `target`'s numeric index up front.
3. For `level < target.height`: merge spans (`pred.span[L] += target.span[L] - 1`) and bypass `target`.
4. For `level >= target.height`: decrement `pred.span[L]--`.

### Lookup asymmetry (`findByIndex` vs `findIndex`)

- **`findByIndex(sl, targetIndex)`** (used on every local keystroke in `buildOp`) climbs spans top-down in **O(log n)**.
- **`findIndex(sl, id)`** (used in `apply.ts` to translate `op.leftOrigin` / `op.target` to an index) currently walks `next[0]` linearly (**O(n)** in document length), returning `-1` when `id` is `ROOT_ID` or a tombstoned origin!
  - **Watch out before "optimizing" `apply.ts`:** Notice that when `op.leftOrigin` has already been tombstoned (removed from `SkipList`), `findIndex` returns `-1`, which makes `idxOfLeft + 1 === 0` if called naively! Keep `NodeStore` position and `SkipList` index consistent whenever touching `apply.ts` (for example, walking backward in `NodeStore` to the nearest non-tombstone predecessor if `leftOrigin` is a tombstone or concurrent siblings intervened).

---

## 4. Local input decomposition (`src/documents/localApply.ts`)

`buildOpFromLocalInput` decomposes range replacements (selected text + paste/typing) into single-unit operations:

1. **Deletes first:** `deletedLength` iterations at fixed `position` (each delete shrinks `SkipList`, sliding the next character into `position`).
2. **Inserts second:** `insertedLength` iterations at `position + i`, incrementing `doc.counter` per UTF-16 code unit and capturing both `nodeLeft.id` (`position + i - 1`, or `ROOT_ID` at `0`) and `nodeRight?.id` (the current occupant at `position + i`).

---

## 5. Tombstone garbage collection (`src/store/gc.ts`)

Physical removal (`runGC`) unlinks tombstones from `NodeStore` once every active peer has causally observed them (`clock <= frontier.get(clientId)`), subject to three local safety invariants:

1. **Origin-anchor guard (`referencedKeys`):** Build the set of every `leftOrigin` and `rightOrigin` cited by _any_ remaining node (live or tombstoned) in `store.nodes`. If `refs.has(key)`, the tombstone **cannot** be collected yet — removing it would break `isDescendantOf` walks or `nodesToOp` reconstruction for adjacent nodes. Unreferenced tails of deleted runs peel off across successive sweeps.
2. **Two-sweep grace window (`GCTracker.candidates`):** The first sweep where a tombstone is unreferenced and `<= frontier` only stamps `candidates.set(key, now)`. Physical deletion happens on a subsequent sweep once `now - eligibleAt >= gracePeriodMs` (default `30_000` ms). If a late op suddenly references `key`, it is evicted from `candidates`.
3. **Single-pass relinking (`buildPrevMap`):** `NodeStore` is singly linked (`node.next`). `runGC` builds a temporary `prevOf` map in one O(N) walk and updates `prevOf.set(nextKey, prev)` as consecutive tombstones unlink so consecutive removals stay O(1) each.

---

## 6. Snapshot serialization (`src/documents/snapshot.ts`)

`takeSnapshot` (`version: 1`) serializes both `NodeStore` and `SkipList` verbatim (including tower heights, `nextKeys`, and `span` arrays) rather than rebuilding the skip list by replaying operations. That makes `restoreSnapshot` **O(N)** in stored nodes with zero RNG variance, while `restoreFromStorage(snapshot, delta)` replays only post-checkpoint `Operation[]` and advances `stateVector` monotonically.
