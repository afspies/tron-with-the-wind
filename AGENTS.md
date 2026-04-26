# Tron with the Wind - Codex Instructions

See [README.md](./README.md) for full architecture and file map.

## Build

```bash
npm run dev     # Vite dev server (hot reload)
npm run build   # tsc + vite build (check for type errors)
```

## Deploy

```bash
curl -sL https://raw.githubusercontent.com/heredotnow/skill/main/here-now/scripts/publish.sh -o /tmp/herenow-publish.sh && chmod +x /tmp/herenow-publish.sh
HERENOW_API_KEY=$HERE_NOW_KEY /tmp/herenow-publish.sh dist --slug tropic-dahlia-2mgy
```

Live URL: https://tropic-dahlia-2mgy.here.now/

## TURN Server

Worker: `https://tron-turn-credentials.alexfspies.workers.dev`

Build with TURN enabled:
```bash
TURN_WORKER_URL=https://tron-turn-credentials.alexfspies.workers.dev npm run build
```

Worker secrets managed via `cd worker && npx wrangler secret put <NAME>`.

## Conventions

- TypeScript strict mode, Three.js for 3D rendering
- Colyseus networking over WebSocket
- Server-authoritative network model: server runs simulation, clients interpolate `ServerMsg.GameSnapshot`
- Gameplay snapshots broadcast at 30Hz with trail append/replace deltas
- Game state machine in `Game.ts`: MENU -> LOBBY -> COUNTDOWN -> PLAYING -> ROUND_END -> GAME_OVER
- New features get their own files in appropriate directories (ui/, game/, etc.)
- `PlayerInput` includes: left, right, jump, boost, drift, pitchUp, pitchDown
- Trail points are 3D (`TrailPoint {x, y, z}`) for jump arcs
- Collision is height-aware (bikes can drive under elevated trails)
