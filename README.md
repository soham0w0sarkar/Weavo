# Relay

> Tiny, framework-agnostic real-time collaborative text editing.

<p align="center">
  <img src="docs/assets/relay-demo-mobile.gif" height="420" alt="Relay demo on mobile" />
  <img src="docs/assets/relay-demo-desktop.gif" height="420" alt="Relay demo on desktop" />
</p>
<p align="center"><sub>Mobile · Desktop — same room, live sync</sub></p>
---

Relay turns any native `<textarea>` into a collaborative editor with a single function call.

No CRDT knowledge. No editor framework. No React dependency. Just bind a textarea, connect to a room, and every participant stays in sync.

**Demo:** https://soham0w0sarkar.github.io/Relay/

---

## Features

- ⚡ Bind any native `HTMLTextAreaElement`
- 🔄 Automatic real-time synchronization
- 🧠 Conflict-free concurrent editing
- 🎯 Cursor/selection preservation during remote edits
- 📦 Tiny, dependency-light client
- 🌐 Works with any compatible Relay WebSocket server
- 🧩 Framework agnostic (React, Vue, Svelte, Solid, Vanilla JS...)

---

## Installation

```bash
npm install @relay/client
```

or

```bash
pnpm add @relay/client
```

or

```bash
bun add @relay/client
```

---

## Quick Start

```ts
import { createRelay } from "@relay/client";

const relay = createRelay(
  "wss://your-server.example.com?room=my-room"
);

const textarea = document.querySelector("textarea")!;

const dispose = relay.bind(textarea);
```

That's it.

Every edit made inside the textarea is synchronized with everyone connected to the same room.

---

## API

### `createRelay(urlOrTransport)`

Creates a Relay document.

```ts
const relay = createRelay(
  "wss://localhost:8080?room=notes"
);
```

You may also provide a custom transport implementation instead of a URL.

---

### `relay.bind(textarea)`

Binds a native textarea to the collaborative document.

```ts
const cleanup = relay.bind(textarea);
```

Returns a cleanup function.

```ts
cleanup();
```

---

### `relay.subscribe(listener)`

Listen for document changes.

```ts
const unsubscribe = relay.subscribe((change) => {
  console.log(change);
});
```

Useful for:

- analytics
- persistence
- live previews
- custom UI updates

---

## How it Works

Relay observes browser input events, converts them into editing operations, synchronizes those operations over WebSockets, and automatically applies incoming changes while preserving the user's current cursor and selection whenever possible.

From the application's perspective, it's simply:

```
User Input
      ↓
Relay
      ↓
WebSocket
      ↓
Everyone Else
```

No manual diffing.

No reconciliation logic.

No polling.

---

## Framework Example

### React

```tsx
const relay = createRelay(url);

useEffect(() => {
    if (!ref.current) return;
    return relay.bind(ref.current);
}, []);
```

Because Relay works directly with the DOM, it can be used with virtually any frontend framework.

---

## Browser Support

Modern browsers supporting:

- WebSocket
- beforeinput events
- HTMLTextAreaElement
- ES Modules

---

## Philosophy

Relay intentionally focuses on one thing:

> Make collaborative textareas ridiculously simple.

It does **not** attempt to become:

- a rich text editor
- an editor framework
- a UI toolkit

Instead, Relay provides a reliable synchronization layer that can be integrated anywhere.

---

## Packages

This repository is a monorepo containing:

| Package | Description |
|----------|-------------|
| `@relay/client` | Browser client |
| `@relay/code` | Collaborative editing engine |
| `@relay/sync` | Synchronization protocol |
| `@relay/transport` | Transport abstraction |

---

## Development

```bash
bun install

bun run dev
```

Build all packages:

```bash
bun run build
```

Run the demo:

```bash
bun run dev
```

---

## License

MIT