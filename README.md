# Tron with the Wind

A 3D Tron lightcycle battle game built with Three.js, TypeScript, and Vite. Features local Quick Play (1 human vs 3 AI) and Online Multiplayer (P2P WebRTC via trystero).

**Live:** https://tropic-dahlia-2mgy.here.now/

## Gameplay

- **Steer** with A/D or arrow keys
- **Jump** with Space (creates 3D trail arcs you can drive under!)
- **Boost** with Shift (1.6x speed, drains meter, recharges when released)
- **Chat** with Enter during online play
- **Mobile** touch controls auto-appear on touch devices

## Game Modes

**Quick Play** — 1 human vs 3 AI, local only. Start immediately.

**Online Play** — Create or join a 4-letter room code. P2P via WebRTC (no server). Host-authoritative: host runs simulation, broadcasts state at 20Hz, clients dead-reckon between updates.

## Architecture

```
src/
  main.ts                 Entry point
  types.ts                Shared types (GameConfig, BikeState, TrailPoint, Vec2)
  game/
    Game.ts               Main loop, state machine (MENU/LOBBY/COUNTDOWN/PLAYING/ROUND_END/GAME_OVER)
    Bike.ts               Bike physics, rendering, particles, boost meter
    Trail.ts              3D trail geometry (points follow bike Y for arcs)
    Collision.ts          Height-aware line-segment intersection
    AI.ts                 Ray-based pathfinding, difficulty presets, height-aware
    Input.ts              Keyboard + virtual input (touch), PlayerInput interface
    Arena.ts              Ground, grid, boundary walls, corner pillars
    Round.ts              Score tracking, round/game state
    constants.ts          All tuning values (speed, gravity, boost, arena size)
  network/
    NetworkManager.ts     Trystero wrapper (WebRTC P2P), actions: input/state/event/lobby/start/chat
  scene/
    SceneSetup.ts         Three.js renderer, post-processing (bloom)
    Camera.ts             Chase + overview camera modes
    Lighting.ts           Ambient, directional, hemisphere lights
    Environment.ts        Sky dome shader, floating particles
  ui/
    Menu.ts               Main menu
    Lobby.ts              Online lobby (create/join, config, player list)
    HUD.ts                Player list, round info, boost bars
    Scoreboard.ts         Round-end and game-over screens
    Chat.ts               Online text chat overlay
    TouchControls.ts      Mobile on-screen buttons
```

## Network Protocol

Actions via `room.makeAction()` (trystero/torrent):

| Action | Direction | Data |
|--------|-----------|------|
| `input` | Client -> Host | `PlayerInput` (left, right, jump, boost) |
| `state` | Host -> All | `NetGameState` (bike positions + trail deltas) @ 20Hz |
| `event` | Host -> All | countdown, round-start, round-end, game-over |
| `lobby` | Host -> All | player list, AI settings |
| `start` | Host -> All | game config, slot assignments |
| `chat` | Any -> All | `ChatMessage` (sender, color, text) |

## Build & Dev

```bash
npm install
npm run dev     # Vite dev server
npm run build   # TypeScript check + Vite production build
```

## Deploy

Deployed via here.now with slug `tropic-dahlia-2mgy`:

```bash
npx here.now deploy --slug tropic-dahlia-2mgy
```
