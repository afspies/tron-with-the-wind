# Tron with the Wind - Claude Code Instructions

## Monorepo Structure

```
apps/web/           @tron/web        Three.js + Vite frontend
apps/server/        @tron/server     Colyseus 0.16 game server
packages/shared/    @tron/shared     Types, constants, protocol enums
packages/game-core/ @tron/game-core  Simulation logic (bikes, trails, collision, AI, powerups)
```

## Build & Dev

```bash
./dev.sh            # Start server (ws://localhost:2567) + web (http://localhost:5173)
npm run build       # TypeScript check + Vite production build (apps/web only)
```

## Deploy

```bash
./deploy.sh prod                  # Bump version, tag, deploy server + web, push tags
./deploy.sh prod server           # Bump + deploy server only
./deploy.sh prod web              # Bump + deploy web only
./deploy.sh prod --no-bump        # Deploy both without version bump (hotfix)
./deploy.sh staging               # Deploy both to staging (no version bump)
./deploy.sh staging server        # Deploy staging server only
./deploy.sh staging web           # Deploy staging web only
./deploy.sh logs [prod|staging]   # Tail server logs
./deploy.sh status [prod|staging] # Show container status
```

Version bumps (prod only): auto-increments patch in `package.json` + `apps/web/package.json`, commits, tags `vX.Y.Z`, pushes after deploy.

### Deploy Flows

**Server:** SSH to VPS, `git pull`, then `docker compose up -d --build` (see `Dockerfile` -- runs via `tsx`, no compile step).

**Web:** `VITE_APP_ENV={env} VITE_COLYSEUS_URL={url} npm run build`, then `wrangler pages deploy` to Cloudflare Pages.

Staging web builds show `v1.0.X (staging)` via `VITE_APP_ENV=staging` (see `apps/web/vite.config.ts` and `apps/web/src/main.ts`).

## Infrastructure

| | Production | Staging |
|---|---|---|
| Web | https://tron.afspies.com | https://tron-staging.afspies.com |
| Server | wss://tron-server.afspies.com | wss://tron-staging-server.afspies.com |
| VPS dir | /opt/tron-prod | /opt/tron-staging |
| Host port | 8080 | 8081 |

Web hosted on Cloudflare Pages. Server runs on Hetzner VPS (Docker, `tsx`) behind Cloudflare proxy (SSL termination) + nginx reverse proxy.

## Environment Variables

`.env` file (see `.env.example`):
- `HETZNER_HOST` -- SSH target for VPS (e.g. `root@46.225.106.111`)
- `CLOUDFLARE_PAGES_PROJECT` -- Cloudflare Pages project name
- `COLYSEUS_PROD_URL` -- Production server WebSocket URL
- `COLYSEUS_STAGING_URL` -- Staging server WebSocket URL

Build-time (set by `deploy.sh`):
- `VITE_COLYSEUS_URL` -- WebSocket server URL for the target environment
- `VITE_APP_ENV` -- `prod` or `staging` (controls version label display)

## Network Protocol

Colyseus 0.16 server-authoritative model:
- Single room type `'tron'`, filtered by `roomCode`
- Schema-based state sync (`@type()` decorators in `apps/server/src/schema/TronState.ts`)
- Message types in `packages/shared/src/protocol.ts` (`ClientMsg`, `ServerMsg` enums)
- Server runs authoritative simulation via `@tron/game-core`
- Clients connect via `colyseus.js` SDK

## Conventions

- TypeScript strict mode, Three.js for 3D rendering
- Server-authoritative via Colyseus 0.16 (not P2P)
- Shared simulation in `@tron/game-core`, used by both server and client
- Game state machine: MENU, LOBBY, COUNTDOWN, PLAYING, ROUND_END, GAME_OVER
- New features get their own files in appropriate directories
- `PlayerInput` includes: left, right, jump, boost, drift
- Trail points are 3D (`TrailPoint {x, y, z}`) for jump arcs
- Collision is height-aware (bikes can drive under elevated trails)
