# `@weavo/monaco-adapter` — Internal Architecture

Coordinate bridging, echo suppression, multi-cursor ordering, and IME composition handling inside `@weavo/monaco-adapter`. For usage, see [`README.md`](./README.md).

---

## 1. Coordinate bridge: `(lineNumber, column)` ↔ UTF-16 offset

Weavo's CRDT and `TextChange` API operate on flat `0`-based UTF-16 code-unit indices. Monaco's `ITextModel` operates on `1`-based `(lineNumber, column)` `Position` and `Range` objects.

All conversions route through `model.getOffsetAt(position)` and `model.getPositionAt(clampOffset(model, offset))` (`src/model.ts`), clamping offsets into `[0, model.getValueLength()]`. Make sure Monaco's model EOL sequence matches `\n` (or stays consistent across peers), since `\r\n` counts as 2 UTF-16 offsets in `model.getOffsetAt`.

---

## 2. Suppressing local echo & undo-stack pollution

Monaco fires `model.onDidChangeContent` synchronously for _both_ user edits and programmatic `model.applyEdits(...)` calls.

- **Re-entrancy guard (`applyingRemote`):** Every programmatic model write wraps `applyEditToModel` in `applyingRemote = true` inside a `try / finally`. `onDidChangeContent` exits immediately when `applyingRemote || composition` is true, preventing remote ops from echoing back into `host.applyLocal` as new local inserts.
- **Undo isolation:** Remote edits use `model.applyEdits([...])` directly (rather than `editor.executeEdits`), which mutates the underlying buffer without pushing remote keystrokes onto the local user's Ctrl+Z / Cmd+Z undo stack.

---

## 3. Multi-cursor edits & directional selection transforms (`src/model.ts`)

### Outbound multi-cursor ordering (`applyLocalChanges`)

When a user types with multiple cursors (or runs "Change All Occurrences"), Monaco emits a single `IModelContentChangeEvent` containing multiple `changes`, where every `change.rangeOffset` refers to the **pre-event** document string.

`applyLocalChanges` sorts `event.changes` **descending by `rangeOffset`** (`right.rangeOffset - left.rangeOffset`) before calling `host.applyLocal` one by one:

- Applying from the end of the document toward index `0` guarantees that earlier `rangeOffset`s remain exact against `host.getText()` without cumulative offset adjustment.

### Inbound selection preservation (`applyEditToModel`)

Monaco selections are directional (`selectionStart*` anchor vs `position*` active head — they differ for right-to-left vs left-to-right selections). Before calling `model.applyEdits`:

1. `captureSelections` converts all editor selections into `{ anchor, active }` offset pairs.
2. Offsets transform first through any `delete` span, then through any `insert` span via `@weavo/client`'s `transformPosition`.
3. `model.applyEdits` runs with `forceMoveMarkers: true`, and `restoreSelections` writes all transformed directional selections back under source tag `"weavo.remote"`.

### Drift self-healing (`textEditFromDiff`)

After `applyRemoteChange(target, model, change)` (and at the end of `onDidCompositionEnd`), the adapter compares `model.getValue()` against `host.getText()` with `textEditFromDiff` (`src/textEdit.ts`). In the normal case strings already match (`===` short-circuit in O(1)/fast scan) and it returns `null`; if EOL normalization or an edge-case edit caused any divergence, a minimal corrective `applyEditToModel` brings Monaco back into byte-for-byte sync with the CRDT replica.

---

## 4. IME composition isolation (`src/bind.ts`)

Mirrors `@weavo/textarea-adapter`'s two-coordinate strategy using `target.onDidCompositionStart` and `target.onDidCompositionEnd`:

- During composition, `onDidChangeContent` drops intermediate IME buffer edits, and `host.onRemote` only transforms `composition.docStart` / `composition.docEnd` without mutating the Monaco model under the active IME candidate window.
- On `onDidCompositionEnd`, the committed text is sliced via `tailLength = current.value.length - current.end`, applied once via `host.applyLocal`, and reconciled onto `model` with `textEditFromDiff` under `applyingRemote = true`.

---

## 5. Read-only lifecycle & model contract

- `bindMonaco` snapshots `originalReadOnly = target.getRawOptions().readOnly ?? false`. Until `host.isJoined()`, the editor is forced `readOnly: true`; on join and on `unbind()`, `readOnly` restores to `originalReadOnly` (rather than blindly setting `false` on an intentionally read-only viewer).
- Listeners attach to the concrete `ITextModel` returned at bind time. Swapping models via `editor.setModel(...)` requires calling `unbind()` first and re-binding.
