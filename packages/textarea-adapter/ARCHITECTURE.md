# `@weavo/textarea-adapter` — Internal Architecture

DOM event ordering, grapheme delete resolution, snapshot drift reconciliation, and IME handling inside `@weavo/textarea-adapter`. For usage, see [`README.md`](./README.md).

---

## 1. Why native `<textarea>` is hostile to CRDTs

Unlike code editors with an explicit model API, the browser mutates `HTMLTextAreaElement.value` **before** `input` fires, and `InputEvent` omits the deleted text and exact replacement offsets. Worse, mobile keyboards, browser spellcheck/autocorrect, and remote WebSocket frames can mutate or desynchronize the snapshot between `beforeinput` and `input`.

The adapter maintains a rolling `before: InputSnapshot` (`{ start, end, value }`) and reconciles every edge case before calling `host.applyLocal`.

---

## 2. Snapshot capture & join gate (`src/bind.ts`)

1. **Join gate:** While `!weavo.isJoined()`, `el.readOnly = true` and `onBeforeInput` calls `event.preventDefault()` so local edits cannot precede membership `shortId` assignment. Once `onJoined` fires, `el.readOnly = false` and the listener self-disposes.
2. **Three-tier `before` capture:**
   - `keydown` (capture phase, `Backspace` / `Delete` only): arms `before` + `pendingInput = true` even in environments where `beforeinput` behaves inconsistently on key-repeat deletes.
   - `beforeinput`: primary pre-mutation snapshot (`before = captureSnapshot(el)`, `pendingInput = true`).
   - `click` / `select` / `keyup`: passive caret/selection refresh (`refreshSnapshot`), skipped whenever `pendingInput || composition` is true so an in-flight edit's baseline isn't clobbered.

---

## 3. Grapheme-cluster & word deletes (`resolveDelete`)

`@weavo/core`'s `onInput` treats a collapsed `deleteContentBackward` as deleting `1` UTF-16 code unit. In a real `<textarea>`, pressing Backspace once can remove:

- **2 code units** (astral emoji surrogate pair like `😀`),
- **many code units** (ZWJ family/skin-tone emoji sequence, `Option+Backspace` word delete, `Cmd+Backspace` line delete).

Instead of forwarding `deleteContentBackward` blindly, `onInput` intercepts every `inputType.startsWith("delete")`:

1. Runs `textChangeFromDiff(before.value, el.value)` (`@weavo/client`) to find the exact `{ index, delete }` UTF-16 span the browser actually removed.
2. Normalizes it into `{ inputType: "deleteContentForward" }` with `{ start: index, end: index + delete, value: before.value }`.

That delegates multi-code-unit grapheme segmentation to the browser's own native text engine while producing exact code-unit delete ops in `@weavo/core`.

---

## 4. Reconciling drifted snapshots (`src/reconcileBefore.ts`)

On non-delete inputs (`insertText`, `insertLineBreak`, `insertFromPaste`), `reconcileBefore(before, el.value, inputType, data)` verifies that `before` still matches what the browser edited:

1. **Fast path (`undoLocalEdit`):** Synthetically reverses the local edit on `el.value` using `before.start`, `before.end`, and `inserted.length`. If the reconstructed string equals `before.value`, no drift happened — return `before` untouched.
2. **Drift recovery (`reconcileDriftedBefore`):** If an untracked mutation slipped into `el.value` (e.g., browser text replacement or race), compute the minimal changed window `diffRegion(before.value, el.value)` via common prefix (`start`) and common suffix (`endOld`, `endNew`):
   - Compute residual `remoteLen` left over after subtracting the known local edit length.
   - Transform `before` across that inferred delta via `transformSnapshot` so `before.start` / `before.end` align with `el.value` before `host.applyLocal` runs.

---

## 5. Remote updates & IME composition isolation

### Normal remote path (`unsubRemote`)

When `!composition`, an incoming remote `{ change, text }` writes `el.value = text` (which resets DOM selection to the end in browsers), then immediately restores transformed `selectionStart` / `selectionEnd` via `transformPosition` and updates `before = transformSnapshot(before, change)`.

### Active IME path (`compositionstart` → `compositionend`)

Writing `el.value = nextText` during an active CJK / dead-key / mobile swipe composition immediately aborts the OS IME popup and duplicates uncommitted characters.

`CompositionState` tracks **two coordinate pairs** simultaneously:

- `start`, `end`, `value`: frozen local DOM coordinates at `compositionstart`
- `docStart`, `docEnd`: CRDT document coordinates

While `composition !== null`:

1. `onBeforeInput` and `onInput` (plus `insertCompositionText`) ignore intermediate DOM mutations.
2. `onRemote` **does not touch `el.value`** — it only shifts `composition.docStart` and `composition.docEnd` through `transformPosition(pos, change)`.
3. On `compositionend` (`commitComposition`):
   - Extracts the committed string from `el.value` using suffix anchoring (`tailLength = comp.value.length - comp.end`, `composedEnd = max(comp.start, el.value.length - tailLength)`).
   - Emits a single atomic `applyLocal({ inputType: "insertText", data: composed }, { start: comp.docStart, end: comp.docEnd, value: weavo.getText() })`.
   - Reconciles `el.value` with `weavo.getText()` (picking up any remote edits that arrived mid-composition) and transforms the final caret via `textChangeFromDiff`.
