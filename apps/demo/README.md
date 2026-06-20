# Relay Demo

Collaborative text editing demo using `@repo/relay`.

## Run

Start the WebSocket relay server and the Next.js demo (two terminals):

```bash
# Terminal 1 — relay server (port 8080)
bun run dev --filter=relay-server

# Terminal 2 — demo app (port 3000)
bun run dev --filter=demo
```

Open [http://localhost:3000](http://localhost:3000) in two browser tabs to see edits sync between them.

## Environment

| Variable | Default |
|----------|---------|
| `NEXT_PUBLIC_RELAY_WS_URL` | `ws://localhost:8080?room=demo` |
| `PORT` (relay-server) | `8080` |
