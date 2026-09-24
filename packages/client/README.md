<p align="center">
  <img src="https://raw.githubusercontent.com/soham0w0sarkar/Weavo/main/docs/assets/logo.png" width="140" alt="weavo" />
</p>

# @weavo/client

Real-time collaborative text editing for the browser. Connect a document to a WebSocket room; pair it with `@weavo/textarea-adapter` or your own adapter so edits sync — including cursor-safe remote updates and concurrent middle-of-document changes.

Built on a deterministic CRDT under the hood, so peers converge without a central server ordering ops.

## Install

```bash
npm install @weavo/client @weavo/textarea-adapter
```

## Quick start

### WebSocket server

```bash
npm install ws
```

```js
// server.js — node server.js
const { WebSocketServer } = require("ws");

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    for (const client of wss.clients) {
      if (client !== ws && client.readyState === 1) client.send(data);
    }
  });
});

console.log("ws://localhost:8080");
```

### Browser client

```bash
npm install @weavo/client @weavo/textarea-adapter
```

```ts
import { createWeavo } from "@weavo/client";
import { textareaAdapter } from "@weavo/textarea-adapter";

const weavo = createWeavo("ws://localhost:8080", {
  adapter: textareaAdapter,
});

const textarea = document.querySelector("textarea")!;
const unbind = weavo.bind(textarea);

// optional: observe text changes (local + remote)
weavo.textSubscribe((change) => {
  console.log(change); // { index: 3, insert: "a" } or { index: 1, delete: 2 }
});

// later
unbind();
weavo.disconnect();
```

That is the full integration for a plain textarea. The adapter listens to native input events, turns them into CRDT operations, sends them over the wire, and applies remote ops back to the element.

### React

```tsx
import { useEffect, useRef } from "react";
import { createWeavo } from "@weavo/client";
import { textareaAdapter } from "@weavo/textarea-adapter";

export function CollaborativeTextarea({ roomUrl }: { roomUrl: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const weavo = createWeavo(roomUrl, { adapter: textareaAdapter });
    const unbind = weavo.bind(el);

    return () => {
      unbind();
      weavo.disconnect();
    };
  }, [roomUrl]);

  return <textarea ref={ref} rows={8} />;
}
```

## What you get

- **Stable binding API** — inject an adapter once, then use `weavo.bind(target)` for textarea or another editor
- **Live sync** — inserts and deletes replicate to every peer in the room
- **Change notifications** — subscribe to a simple `{ index, insert?, delete? }` stream for UI side-effects

## API

### `createWeavo(urlOrTransport, options?)`

Creates a Weavo instance for one client.

| Argument         | Type                     | Description                                                                      |
| ---------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `urlOrTransport` | `string \| RawTransport` | WebSocket URL (e.g. `ws://host:8080?room=doc-1`) or a custom transport for tests |
| `options`        | `WeavoOptions`           | Optional persistence hooks (see below)                                           |

```ts
type WeavoOptions = {
  /** Supplies the editor-specific implementation behind weavo.bind(target). */
  adapter?: WeavoAdapter<TTarget>;
  /** Called for every local and remote operation — use to append to a delta log. */
  onOp?: (op: Operation) => void;
  /** Restore a previously saved base snapshot plus any ops since that checkpoint. */
  initial?: {
    snapshot: DocumentSnapshot;
    delta?: Operation[];
  };
};
```

Returns:

| Property                  | Type                                                      | Description                                                 |
| ------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| `bind(target)`            | Delegate binding to the adapter passed into `createWeavo` |
| `textSubscribe(listener)` | `(listener: (change: TextChange) => void) => () => void`  | Subscribe to text changes. Returns an unsubscribe function. |
| `snapshot()`              | `() => DocumentSnapshot`                                  | Capture a JSON-serializable checkpoint of the document.     |
| `disconnect()`            | `() => void`                                              | Close the transport connection.                             |

### `TextChange`

```ts
type TextChange = {
  index: number;
  insert?: string;
  delete?: number;
};
```

- **Insert** — `insert` is the string that was added at `index`
- **Delete** — `delete` is the number of characters removed at `index`

## How it works (short version)

1. **An adapter binds** the editor — textarea today, others later — and captures selection around each edit.
2. **Local input** becomes CRDT operations and is sent to peers.
3. **Remote operations** update the document; the adapter writes the merged text back.
4. **Selection and pending input** are transformed so concurrent edits do not corrupt the next local keystroke.

You do not manage operation IDs, state vectors, or index mapping yourself for the basic textarea case. Use [`@weavo/textarea-adapter`](https://www.npmjs.com/package/@weavo/textarea-adapter) for that.

## Persistence (snapshots)

Weavo does not ship a storage backend. Instead, you checkpoint the CRDT state yourself and replay it on the next visit.

**Pattern:** store a **base snapshot** plus a **delta** of operations since that checkpoint.

```ts
import {
  createWeavo,
  type DocumentSnapshot,
  type Operation,
} from "@weavo/client";
import { textareaAdapter } from "@weavo/textarea-adapter";
import {
  base64ToBytes,
  bytesToBase64,
  decodeDelta,
  decodeDocumentSnapshot,
  encodeDelta,
  encodeDocumentSnapshot,
} from "@weavo/transport";

// --- restore on load ---
const snapshot = decodeDocumentSnapshot(
  base64ToBytes(localStorage.getItem("doc:snapshot")!),
);
const delta = decodeDelta(
  base64ToBytes(
    localStorage.getItem("doc:delta") ?? bytesToBase64(encodeDelta([])),
  ),
);

const weavo = createWeavo("ws://localhost:8080?room=notes", {
  adapter: textareaAdapter,
  initial: { snapshot, delta },
  onOp(op) {
    const ops = decodeDelta(base64ToBytes(localStorage.getItem("doc:delta")!));
    ops.push(op);
    localStorage.setItem("doc:delta", bytesToBase64(encodeDelta(ops)));
  },
});

weavo.bind(textarea);

// --- checkpoint periodically or on unload ---
function checkpoint() {
  localStorage.setItem(
    "doc:snapshot",
    bytesToBase64(encodeDocumentSnapshot(weavo.snapshot())),
  );
  localStorage.setItem("doc:delta", bytesToBase64(encodeDelta([])));
}

window.addEventListener("pagehide", checkpoint);
```

`DocumentSnapshot` stays a typed in-memory object; `@weavo/transport` binary-encodes it for storage (UUID-stable — do not persist shortIds). JSON still works if you prefer. After restore, live sync continues over WebSocket as usual.

**Tips**

- Checkpoint every N ops, on first edit, and on `pagehide` / unmount (see the [demo app](https://github.com/soham0w0sarkar/Weavo/tree/main/apps/demo)).
- `onOp` fires for both local and remote operations, so one delta log stays complete.
- `weavo.snapshot()` includes the state vector, so peers can catch up after reload.

For server-side or custom editors, use the lower-level helpers from `@weavo/core`: `takeSnapshot`, `restoreSnapshot`, `replayOperations`, and `restoreFromStorage`.

## Custom transport

For unit tests or non-WebSocket backends, pass a transport that implements the `RawTransport` interface from `@weavo/transport`:

```ts
import { createWeavo } from "@weavo/client";
import { createTransport, type RawTransport } from "@weavo/transport";

const raw: RawTransport = {
  connect() {
    /* ... */
  },
  disconnect() {
    /* ... */
  },
  send(data) {
    /* ... */
  },
  onMessage(cb) {
    /* return unsubscribe */ return () => {};
  },
  onOpen(cb) {
    return () => {};
  },
  onClose(cb) {
    return () => {};
  },
};

const weavo = createWeavo(raw);
```

## Requirements

- **WebSocket relay** — any server that broadcasts messages between connected clients (see Quick start). Use `wss://` in production.

## Limitations

- **Bring your own editor adapter** — use `@weavo/textarea-adapter` or implement `WeavoAdapterHost`.
- **One adapter per instance** — create another `createWeavo()` per editor if you need multiple.
- **Bring your own storage** — snapshot + delta helpers are provided; you choose where to persist them.

## Reconnection

`@weavo/client` reconnects automatically when the WebSocket drops (idle timeouts, server restarts, network blips). While disconnected, outgoing ops are queued and flushed on reconnect; a sync request runs on each reconnect so you catch up on missed edits. Call `disconnect()` to close intentionally without retrying.

## Development

```bash
# from packages/clint
bun test
bun run build
```

## License

MIT
