# Relay Demo

Collaborative text editing demo using `@relay/client`.

Each visit gets a random room UUID in the URL (`?room=…`). Share that link so others join the same document.

## Run locally

```bash
# Terminal 1 — relay server (port 8080)
bun run dev --filter=relay-server

# Terminal 2 — demo app (port 3000)
bun run dev --filter=demo
```

Open [http://localhost:3000](http://localhost:3000). Copy the room link and open it in another tab to sync edits.

## Deploy to GitHub Pages

The demo is a static Next.js export deployed from `main` via [`.github/workflows/deploy-demo.yml`](../../.github/workflows/deploy-demo.yml).

**Live URL:** [https://soham0w0sarkar.github.io/Relay/](https://soham0w0sarkar.github.io/Relay/)

### One-time setup

1. On GitHub: **Settings → Pages → Build and deployment → Source** → **GitHub Actions**.
2. (Recommended) Add repository secret **`RELAY_WS_URL`** with your public WebSocket base URL, e.g. `wss://your-relay.example.com` (no `?room=` — the app adds that per session). Without this, the site defaults to `ws://localhost:8080`, which only works locally.
3. Deploy `apps/relay-server` separately (Railway, Fly.io, Render, etc.) for live collaboration on the hosted demo.

### Deploy

Push to `main`, or run **Deploy demo to GitHub Pages** from the Actions tab.

### Local Pages build

```bash
cd apps/demo
NEXT_STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH=/Relay \
  NEXT_PUBLIC_RELAY_WS_URL=wss://your-relay.example.com \
  bun run build:pages
```

Static files are written to `apps/demo/out/`.

## Deploy to Vercel (optional)

See `vercel.json`. Set root directory to `apps/demo` and `NEXT_PUBLIC_RELAY_WS_URL` to your relay server. You still need a separate WebSocket host.

## Environment

| Variable | Default | Notes |
|----------|---------|-------|
| `NEXT_PUBLIC_RELAY_WS_URL` | `ws://localhost:8080` | Relay WebSocket **base** URL (room UUID appended client-side). Set `RELAY_WS_URL` secret in GitHub Actions for Pages. |
| `NEXT_STATIC_EXPORT` | unset | Set to `1` for GitHub Pages static export |
| `NEXT_PUBLIC_BASE_PATH` | `""` | Set to `/Relay` for this repo on GitHub Pages (`/${{ repository.name }}` in CI) |
| `PORT` (relay-server) | `8080` | Relay server only |

GitHub Pages hosts the static UI only. The relay server must run elsewhere for sync to work in production.
