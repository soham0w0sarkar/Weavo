# Relay Demo

Collaborative text editing demo using `@repo/relay`.

## Run locally

Start the WebSocket relay server and the Next.js demo (two terminals):

```bash
# Terminal 1 — relay server (port 8080)
bun run dev --filter=relay-server

# Terminal 2 — demo app (port 3000)
bun run dev --filter=demo
```

Open [http://localhost:3000](http://localhost:3000) in two browser tabs to see edits sync between them.

## Deploy to GitHub Pages

The demo is a static export deployed from `main` via [`.github/workflows/deploy-demo.yml`](../../.github/workflows/deploy-demo.yml).

**Live URL:** [https://soham0w0sarkar.github.io/Relay/](https://soham0w0sarkar.github.io/Relay/)

### One-time setup

1. In the repo on GitHub: **Settings → Pages → Build and deployment → Source** → **GitHub Actions**.
2. (Optional) Add a repository secret `RELAY_WS_URL` with your public WebSocket URL (e.g. `wss://your-relay.example.com?room=demo`). Without this, the deployed site defaults to `ws://localhost:8080`, which only works on your machine.

### Manual deploy

Push to `main`, or run the **Deploy demo to GitHub Pages** workflow from the Actions tab.

### Local Pages build

```bash
cd apps/demo
NEXT_PUBLIC_BASE_PATH=/Relay bun run build:pages
```

Static files are written to `apps/demo/out/`.

## Environment

| Variable                   | Default                         | Notes                                               |
| -------------------------- | ------------------------------- | --------------------------------------------------- |
| `NEXT_PUBLIC_RELAY_WS_URL` | `ws://localhost:8080?room=demo` | Set `RELAY_WS_URL` secret in CI for production sync |
| `NEXT_PUBLIC_BASE_PATH`    | `""`                            | Set to `/Relay` for GitHub Pages                    |
| `PORT` (relay-server)      | `8080`                          | Local relay server only                             |

GitHub Pages hosts the static UI only. Deploy `apps/relay-server` separately (Fly.io, Railway, etc.) and point `RELAY_WS_URL` at it for live collaboration on the hosted demo.
