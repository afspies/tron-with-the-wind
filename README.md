# Tron with the Wind

A 3D Tron lightcycle battle game built with Three.js, TypeScript, and Colyseus. Features local Quick Play (1 human vs 3 AI) and Online Multiplayer (server-authoritative via Colyseus WebSocket).

**Live:** https://tron.afspies.com

## Gameplay

- **Steer** with A/D or arrow keys
- **Jump** with Space (creates 3D trail arcs you can drive under!)
- **Boost** with Shift (1.6x speed, drains meter, recharges when released)
- **Chat** with Enter during online play
- **Mobile** touch controls auto-appear on touch devices

## Game Modes

**Quick Play** — 1 human vs 3 AI, local only. Start immediately.

**Online Play** — Create or join a 4-letter room code. Server-authoritative: Colyseus server runs the simulation, clients sync via schema state.

## Architecture

```
apps/
  web/src/                  Three.js + Vite frontend
    main.ts                 Entry point
    constants.ts            Client constants
    game/                   Game loop, bikes, trails, collision, AI, input, arena, round
    network/                Colyseus client connection
    scene/                  Three.js renderer, camera, lighting, environment
    ui/                     Menu, lobby, HUD, scoreboard, chat, touch controls
  server/src/               Colyseus 0.16 game server
    index.ts                Server entry point
    TronRoom.ts             Game room logic
    schema/                 Colyseus schema definitions

packages/
  shared/src/               Shared types, constants, protocol enums
  game-core/src/            Authoritative simulation (bikes, trails, collision, AI, powerups)
```

## Network Protocol

Colyseus 0.16 server-authoritative model with schema-based state sync:

| Direction | Mechanism | Data |
|-----------|-----------|------|
| Client → Server | Messages (`ClientMsg`) | Player input (left, right, jump, boost), lobby actions |
| Server → Client | Schema sync | Bike positions, trails, game state, scores |
| Server → Client | Messages (`ServerMsg`) | Events (countdown, round-end, game-over), chat |

## Build & Dev

```bash
npm install
./dev.sh            # Start server (ws://localhost:2567) + web (http://localhost:5173)
npm run build       # TypeScript check + Vite production build
```

## Deploy

```bash
./deploy.sh prod              # Bump version, deploy server + web
./deploy.sh staging           # Deploy to staging (no bump)
./deploy.sh logs [prod|staging]  # Tail server logs
```

See [CLAUDE.md](./CLAUDE.md) for full deploy CLI reference.
