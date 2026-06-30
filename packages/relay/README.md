# @relay/client

Real-time collaborative text editing for the browser. Bind a `<textarea>`, connect to a WebSocket room, and edits sync automatically — including cursor-safe remote updates and concurrent middle-of-document changes.

Built on a deterministic CRDT under the hood, so peers converge without a central server ordering ops.

## Install

```bash
npm install @relay/client
```

This package expects peer dependencies from the Relay stack (`@relay/code`, `@relay/sync`, `@relay/transport`). In this monorepo they are wired automatically; when publishing standalone, install the matching versions together.

## Quick start

```ts
import { createRelay } from "@relay/client";

const roomId = crypto.randomUUID();
const relay = createRelay(`ws://localhost:8080?room=${roomId}`);

const textarea = document.querySelector("textarea")!;
const unbind = relay.bind(textarea);

// optional: observe text changes (local + remote)
relay.textSubscribe((change) => {
  console.log(change); // { index: 3, insert: "a" } or { index: 1, delete: 2 }
});

// later
unbind();
relay.disconnect();
```

That is the full integration for a plain textarea. Relay listens to native input events, turns them into CRDT operations, sends them over the wire, and applies remote ops back to the element.

### React

```tsx
import { useEffect, useRef } from "react";
import { createRelay } from "@relay/client";

export function CollaborativeTextarea({ roomUrl }: { roomUrl: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const relay = createRelay(roomUrl);
    const unbind = relay.bind(el);

    return () => {
      unbind();
      relay.disconnect();
    };
  }, [roomUrl]);

  return <textarea ref={ref} rows={8} />;
}
```

## What you get

- **Drop-in textarea binding** — no custom editor required to start
- **Live sync** — inserts and deletes replicate to every peer in the room
- **Cursor preservation** — when someone else edits before your caret, your selection shifts correctly
- **Race-safe input** — pending local edits stay consistent when remote changes arrive mid-keystroke
- **Change notifications** — subscribe to a simple `{ index, insert?, delete? }` stream for UI side-effects

## API

### `createRelay(urlOrTransport)`

Creates a relay instance for one client.

| Argument         | Type                     | Description                                                                      |
| ---------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `urlOrTransport` | `string \| RawTransport` | WebSocket URL (e.g. `ws://host:8080?room=doc-1`) or a custom transport for tests |

Returns:

| Property                  | Type                                                     | Description                                                 |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| `bind(el)`                | `(el: HTMLTextAreaElement) => () => void`                | Attach to a textarea. Returns an unbind function.           |
| `textSubscribe(listener)` | `(listener: (change: TextChange) => void) => () => void` | Subscribe to text changes. Returns an unsubscribe function. |
| `disconnect()`            | `() => void`                                             | Close the transport connection.                             |

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

1. **You bind** a textarea — Relay captures selection and value around each edit.
2. **Local input** becomes CRDT operations and is sent to peers.
3. **Remote operations** update the document and the textarea text from the merged CRDT state.
4. **Selection and pending input** are transformed so concurrent edits do not corrupt the next local keystroke.

You do not manage operation IDs, state vectors, or index mapping yourself for the basic textarea case.

## Custom transport

For unit tests or non-WebSocket backends, pass a transport that implements the `RawTransport` interface from `@relay/transport`:

```ts
import { createRelay } from "@relay/client";
import {
  createTransport,
  type RawTransport,
} from "@relay/transport";

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

const relay = createRelay(raw);
```

## Requirements

- **Browser** with `HTMLTextAreaElement` and `InputEvent` (Relay is built for DOM editors)
- **Relay sync server** — a WebSocket endpoint that broadcasts ops per `?room=` query param (see `apps/relay-server` and `apps/demo` in this repo). Deploy the UI (e.g. Vercel) and relay server separately; use `wss://` in production.

## Limitations

- **Textarea only today** — built for `<textarea>`; rich-text editors need a different binding layer.
- **One bound element per instance** — create another `createRelay()` per editor if you need multiple.
- **No built-in persistence** — load initial document state yourself; Relay handles live collaboration.

## Development

```bash
# from packages/relay
bun test
bun run build
```

## License

Private / see repository root.
