import * as THREE from 'three';
import { GameConfig, GameState } from '../types';
import { createSceneContext, SceneContext } from '../scene/SceneSetup';
import { GameCamera } from '../scene/Camera';
import { setupLighting } from '../scene/Lighting';
import { setupEnvironment, updateEnvironment } from '../scene/Environment';
import { Arena } from './Arena';
import { Bike } from './Bike';
import { Trail } from './Trail';
import { InputManager } from './Input';
import { AIController } from './AI';
import { Round } from './Round';
import { Menu } from '../ui/Menu';
import { HUD } from '../ui/HUD';
import { Scoreboard } from '../ui/Scoreboard';
import { NetworkManager, NetGameState, NetEvent, StartMessage } from '../network/NetworkManager';
import { encodeGameState } from '../network/BinaryCodec';
import { Lobby } from '../ui/Lobby';
import { TouchControls } from '../ui/TouchControls';
import { Chat } from '../ui/Chat';
import { Minimap } from '../ui/Minimap';
import { PowerUp, PowerUpType, generateSpawnPosition } from './PowerUp';
import {
  PLAYER_COLORS, PLAYER_NAMES, COUNTDOWN_DURATION, NET_STATE_INTERVAL, NET_TICK_DURATION_MS,
  SPAWN_POSITIONS, POWERUP_SPAWN_INTERVAL, POWERUP_SPAWN_DELAY, POWERUP_MAX_ACTIVE,
  TRAIL_DESTROY_RADIUS,
} from './constants';

export class Game {
  private ctx: SceneContext;
  private gameCamera: GameCamera;
  private arena!: Arena;
  private bikes: Bike[] = [];
  private trails: Trail[] = [];
  private input: InputManager;
  private aiControllers: Map<number, AIController> = new Map();
  private round!: Round;
  private state: GameState = 'MENU';
  private config!: GameConfig;
  private clock = new THREE.Clock();
  private countdownTimer = 0;
  private elapsedTime = 0;

  // Network
  private net: NetworkManager;
  private lobby: Lobby;
  private lastBroadcastTime = 0;
  private lastBroadcastTrailLen: number[] = [];
  private lastPingTime = 0;
  private currentPing = -1;
  private hostTick = 0;
  private clientTick = 0;
  private clientTickAccumulator = 0;
  private clientTickSynced = false;

  // Power-ups
  private powerUps: PowerUp[] = [];
  private nextPowerUpId = 0;
  private powerUpSpawnTimer = 0;
  private forceFullTrailResync = false;

  // UI
  private menu: Menu;
  private hud: HUD;
  private scoreboard: Scoreboard;
  private countdownEl: HTMLElement;
  private touchControls: TouchControls;
  private chat: Chat;
  private minimap: Minimap;

  constructor() {
    this.gameCamera = new GameCamera();
    this.ctx = createSceneContext(this.gameCamera.camera);
    this.input = new InputManager();
    this.hud = new HUD();
    this.scoreboard = new Scoreboard();
    this.countdownEl = document.getElementById('countdown')!;

    this.touchControls = new TouchControls(this.input);
    this.chat = new Chat();
    this.minimap = new Minimap();

    setupLighting(this.ctx.scene);
    setupEnvironment(this.ctx.scene);
    this.arena = new Arena(this.ctx.scene);

    // Network
    this.net = new NetworkManager();

    this.menu = new Menu(
      (config) => this.startGame(config),
      () => {
        // Online button clicked — show create/join
        this.lobby.showCreateJoin();
      },
    );

    this.lobby = new Lobby(
      this.net,
      () => this.handleLobbyStart(),
      () => {
        // Leave lobby — back to menu
        this.state = 'MENU';
        this.menu.show();
      },
    );

    // Network event handlers
    this.net.onGameStart = (msg) => this.handleNetGameStart(msg);
    this.net.onStateReceived = (state) => this.handleNetState(state);
    this.net.onEventReceived = (event) => this.handleNetEvent(event);
    this.net.onPeerDisconnect = (peerId) => this.handlePeerDisconnect(peerId);
    this.net.onChatReceived = (msg) => this.chat.addMessage(msg);

    // Host disconnected UI
    document.getElementById('btn-dc-menu')!.addEventListener('click', () => {
      document.getElementById('host-disconnected')!.style.display = 'none';
      this.net.leaveRoom();
      this.cleanupBikes();
      this.state = 'MENU';
      this.menu.show();
    });

    this.loop();
  }

  // --- Lobby / Online Flow ---

  private handleLobbyStart(): void {
    // Host clicks Start in lobby
    if (!this.net.isHost) return;

    const lobby = this.net.lobbyState;
    const humanCount = lobby.players.length;
    const aiCount = lobby.aiCount;

    // Cap total to 4
    const maxAI = 4 - humanCount;
    const actualAI = Math.min(aiCount, maxAI);

    // Build slot assignments: humans get their slots, AI fills remaining
    const humanSlots = new Set(lobby.players.map(p => p.slot));
    const aiSlots: number[] = [];
    for (let s = 0; s < 4 && aiSlots.length < actualAI; s++) {
      if (!humanSlots.has(s)) aiSlots.push(s);
    }

    const startMsg: StartMessage = {
      playerCount: humanCount + actualAI,
      aiCount: actualAI,
      aiDifficulty: lobby.aiDifficulty,
      roundsToWin: lobby.roundsToWin,
      slots: lobby.players.map(p => ({ peerId: p.peerId, slot: p.slot })),
    };

    this.net.broadcastStart(startMsg);

    // Host also starts locally
    this.startOnlineGame(startMsg);
  }

  private handleNetGameStart(msg: StartMessage): void {
    // Client received start from host
    if (this.net.isHost) return;
    this.startOnlineGame(msg);
  }

  private startOnlineGame(msg: StartMessage): void {
    const localSlot = this.net.getLocalSlot();

    const config: GameConfig = {
      humanCount: msg.slots.length,
      aiCount: msg.aiCount,
      aiDifficulty: msg.aiDifficulty,
      roundsToWin: msg.roundsToWin,
      mode: 'online',
      localSlot,
    };

    this.lobby.hide();
    this.startGame(config);
  }

  // --- Game Start ---

  private startGame(config: GameConfig): void {
    this.config = config;
    this.menu.hide();
    this.scoreboard.hideAll();

    // Clean up old bikes
    this.cleanupBikes();

    const totalPlayers = config.humanCount + config.aiCount;

    // Create bikes for all slots
    // For online mode, we need to figure out which slots are humans and which are AI
    if (config.mode === 'online') {
      // Collect all active slots: human slots from lobby + AI fills remaining
      const activeSlots: number[] = [];
      const lobbyPlayers = this.net.lobbyState.players;
      for (const p of lobbyPlayers) activeSlots.push(p.slot);

      // AI slots fill remaining
      for (let s = 0; s < 4 && activeSlots.length < totalPlayers; s++) {
        if (!activeSlots.includes(s)) activeSlots.push(s);
      }
      activeSlots.sort((a, b) => a - b);

      for (const slot of activeSlots) {
        const bike = new Bike(
          slot,
          PLAYER_COLORS[slot],
          0, 0, 0,
          this.ctx.scene,
        );
        this.bikes.push(bike);
        this.trails.push(bike.trail);

        // AI for non-human slots (host only)
        if (this.net.isHost && !lobbyPlayers.some(p => p.slot === slot)) {
          this.aiControllers.set(slot, new AIController(config.aiDifficulty));
        }
      }

      this.lastBroadcastTrailLen = new Array(this.bikes.length).fill(0);
    } else {
      // Quickplay mode
      for (let i = 0; i < totalPlayers; i++) {
        const bike = new Bike(
          i,
          PLAYER_COLORS[i],
          0, 0, 0,
          this.ctx.scene,
        );
        this.bikes.push(bike);
        this.trails.push(bike.trail);

        if (i >= config.humanCount) {
          this.aiControllers.set(i, new AIController(config.aiDifficulty));
        }
      }
    }

    this.round = new Round(this.bikes.length);

    // Camera mode
    const localSlot = config.localSlot ?? 0;
    const localBikeIdx = this.bikes.findIndex(b => b.playerIndex === localSlot);
    this.gameCamera.setLocalBikeIndex(localBikeIdx >= 0 ? localBikeIdx : 0);

    if (config.mode === 'online') {
      // Online: always chase cam following local player
      this.gameCamera.setMode('chase');
      // Mark local bike for client-side prediction (clients only, not host)
      if (!this.net.isHost) {
        const localBike = this.bikes.find(b => b.playerIndex === localSlot);
        if (localBike) localBike.isLocalPredicted = true;
      }
      // Show chat for online play
      const localSlotChat = config.localSlot ?? 0;
      this.chat.show(
        PLAYER_NAMES[localSlotChat],
        PLAYER_COLORS[localSlotChat],
        (msg) => this.net.broadcastChat(msg),
      );
    } else if (config.humanCount === 1) {
      this.gameCamera.setMode('chase');
    } else {
      this.gameCamera.setMode('overview');
    }

    this.startRound();
  }

  private startRound(): void {
    this.disposePowerUps();
    this.powerUpSpawnTimer = -POWERUP_SPAWN_DELAY; // negative = wait before first spawn
    this.round.startRound(this.bikes);
    this.state = 'COUNTDOWN';
    this.countdownTimer = COUNTDOWN_DURATION;
    this.countdownEl.style.display = 'block';

    const localSlot = this.config.localSlot;
    this.hud.show(
      this.bikes.length,
      this.round.roundNumber,
      this.config.roundsToWin,
      this.config.mode === 'online' ? this.bikes.findIndex(b => b.playerIndex === localSlot) : undefined,
      this.config.mode === 'online',
    );

    // Show minimap
    const localBikeIdx = this.bikes.findIndex(b => b.playerIndex === (this.config.localSlot ?? 0));
    this.minimap.show(localBikeIdx >= 0 ? localBikeIdx : 0);

    // Show touch controls during gameplay
    this.touchControls.show();

    // Reset broadcast/tick tracking
    this.lastBroadcastTrailLen = new Array(this.bikes.length).fill(0);
    this.lastBroadcastTime = 0;
    this.hostTick = 0;
    this.clientTick = 0;
    this.clientTickAccumulator = 0;
    this.clientTickSynced = false;

    // Host broadcasts round-start event
    if (this.config.mode === 'online' && this.net.isHost) {
      this.net.broadcastEvent({
        type: 'round-start',
        round: this.round.roundNumber,
      });
    }
  }

  private cleanupBikes(): void {
    for (const bike of this.bikes) {
      bike.dispose(this.ctx.scene);
    }
    this.bikes = [];
    this.trails = [];
    this.aiControllers.clear();
    this.disposePowerUps();
    this.chat.hide();
    this.minimap.hide();
    this.touchControls.hide();
  }

  // --- Main Loop ---

  private loop = (): void => {
    requestAnimationFrame(this.loop);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsedTime += dt;

    switch (this.state) {
      case 'MENU':
        break;

      case 'LOBBY':
        break;

      case 'COUNTDOWN':
        this.countdownTimer -= dt;
        const display = Math.ceil(this.countdownTimer);
        this.countdownEl.textContent = display > 0 ? String(display) : 'GO!';

        if (this.countdownTimer <= -0.5) {
          this.countdownEl.style.display = 'none';
          this.state = 'PLAYING';
        }
        break;

      case 'PLAYING':
        if (this.config.mode === 'online') {
          if (this.net.isHost) {
            this.updatePlayingHost(dt);
          } else {
            this.updatePlayingClient(dt);
          }
        } else {
          this.updatePlayingLocal(dt);
        }
        break;

      case 'ROUND_END':
        break;

      case 'GAME_OVER':
        break;
    }

    // Always update camera and render
    this.gameCamera.update(dt, this.bikes);

    // Hide local player's trail near the bike in first-person mode
    const fpBlend = this.gameCamera.fpBlendValue;
    const localBikeIdx = this.bikes.findIndex(b => b.playerIndex === (this.config?.localSlot ?? 0));
    if (localBikeIdx >= 0 && fpBlend > 0) {
      const trail = this.bikes[localBikeIdx].trail;
      const totalSegs = trail.points.length - 1;
      if (totalSegs > 0) {
        const hideSegs = Math.round(8 * fpBlend);
        const visibleSegs = Math.max(0, totalSegs - hideSegs);
        trail.mesh.geometry.setDrawRange(0, visibleSegs * 6);
      }
    }

    updateEnvironment(this.ctx.scene, this.elapsedTime);
    this.ctx.composer.render();
  };

  // --- Local (Quickplay) Update ---

  private updatePlayingLocal(dt: number): void {
    for (const bike of this.bikes) {
      if (!bike.alive) {
        bike.update(dt, { left: false, right: false, jump: false, boost: false }, this.trails);
        continue;
      }

      let input;
      if (this.aiControllers.has(bike.playerIndex)) {
        input = this.aiControllers.get(bike.playerIndex)!.getInput(
          bike, this.trails, this.elapsedTime,
          this.powerUps.filter(p => p.active).map(p => ({ x: p.x, z: p.z })),
        );
      } else {
        input = this.input.getInput(bike.playerIndex);
      }

      bike.update(dt, input, this.trails);
    }

    this.updatePowerUps(dt);
    this.hud.update(this.bikes, this.round.roundNumber, this.config.roundsToWin);
    this.minimap.update(this.bikes, this.powerUps);
    this.checkRoundEnd();
  }

  // --- Host Update ---

  private updatePlayingHost(dt: number): void {
    const localSlot = this.config.localSlot ?? 0;

    for (const bike of this.bikes) {
      if (!bike.alive) {
        bike.update(dt, { left: false, right: false, jump: false, boost: false }, this.trails);
        continue;
      }

      let input;
      if (this.aiControllers.has(bike.playerIndex)) {
        // AI
        input = this.aiControllers.get(bike.playerIndex)!.getInput(
          bike, this.trails, this.elapsedTime,
          this.powerUps.filter(p => p.active).map(p => ({ x: p.x, z: p.z })),
        );
      } else if (bike.playerIndex === localSlot) {
        // Local host input
        input = this.input.getInput(0); // Host always uses P1 keys
      } else {
        // Remote peer input
        const peerEntry = this.net.lobbyState.players.find(p => p.slot === bike.playerIndex);
        if (peerEntry) {
          input = this.net.peerInputs.get(peerEntry.peerId) || { left: false, right: false, jump: false, boost: false };
        } else {
          input = { left: false, right: false, jump: false, boost: false };
        }
      }

      bike.update(dt, input, this.trails);
    }

    this.updatePowerUps(dt);
    this.hud.update(this.bikes, this.round.roundNumber, this.config.roundsToWin);
    this.minimap.update(this.bikes, this.powerUps);
    this.hud.updatePing(this.currentPing);

    // Ping peers every 2s
    const now = performance.now();
    if (now - this.lastPingTime >= 2000) {
      this.lastPingTime = now;
      const peerIds = this.net.getPeerIds();
      if (peerIds.length > 0) {
        Promise.all(peerIds.map(id => this.net.pingPeer(id))).then(pings => {
          const valid = pings.filter(p => p >= 0);
          this.currentPing = valid.length > 0 ? Math.max(...valid) : -1;
        });
      }
    }

    // Broadcast state at 20Hz
    if (now - this.lastBroadcastTime >= NET_STATE_INTERVAL) {
      this.broadcastGameState();
      this.lastBroadcastTime = now;
    }

    this.checkRoundEnd();
  }

  private broadcastGameState(): void {
    this.hostTick++;

    // Pack bike states as flat number arrays: [x, z, y, angle, alive, vy, grounded, boostMeter, boosting, invulnerable, invulnerableTimer]
    const bikeStates = this.bikes.map(b => [
      b.position.x,
      b.position.z,
      b.position.y,
      b.angle,
      b.alive ? 1 : 0,
      b.vy,
      b.grounded ? 1 : 0,
      b.boostMeter,
      b.boosting ? 1 : 0,
      b.invulnerable ? 1 : 0,
      b.invulnerableTimer,
      b.doubleJumpCooldown,
    ]);

    // Pack trail deltas as flat [x, y, z, x, y, z, ...]
    const trailDeltas = this.bikes.map((b, i) => {
      const trail = b.trail;
      const lastLen = this.lastBroadcastTrailLen[i] || 0;
      // Clamp: if trail shrank (segments deleted), send empty delta
      const startIdx = Math.min(lastLen, trail.points.length);
      const newPoints = trail.points.slice(startIdx);
      this.lastBroadcastTrailLen[i] = trail.points.length;
      const flat: number[] = [];
      for (const p of newPoints) {
        flat.push(p.x, p.y, p.z);
      }
      return flat;
    });

    const trailLengths = this.bikes.map(b => b.trail.points.length);

    // Full trail resync every ~5 seconds (150 ticks at 30Hz) or forced after trail destruction
    const includeFullTrails = this.hostTick % 150 === 0 || this.forceFullTrailResync;
    this.forceFullTrailResync = false;

    const state: NetGameState = {
      tick: this.hostTick,
      bikes: bikeStates,
      trailDeltas,
      trailLengths,
      ...(includeFullTrails && {
        fullTrails: this.bikes.map(b => {
          const flat: number[] = [];
          for (const p of b.trail.points) flat.push(p.x, p.y, p.z);
          return flat;
        }),
      }),
    };
    this.net.broadcastStateBinary(encodeGameState(state));
  }

  // --- Client Update ---

  private updatePlayingClient(dt: number): void {
    // Advance client tick clock (runs at same rate as host broadcast)
    if (this.clientTickSynced) {
      this.clientTickAccumulator += dt * 1000;
      while (this.clientTickAccumulator >= NET_TICK_DURATION_MS) {
        this.clientTickAccumulator -= NET_TICK_DURATION_MS;
        this.clientTick++;
      }
    }

    // Send local input to host
    const input = this.input.getInput(0); // Client always uses P1 keys
    this.net.sendInputToHost(input);

    // Dead-reckon all bikes using tick-based interpolation
    const tickFraction = this.clientTickAccumulator / NET_TICK_DURATION_MS;
    const renderTick = this.clientTick + tickFraction;

    for (const bike of this.bikes) {
      if (!bike.alive) {
        bike.update(dt, { left: false, right: false, jump: false, boost: false }, this.trails);
        continue;
      }
      if (bike.isLocalPredicted) {
        // Local player: run full physics for instant response (skip collision — host is authoritative)
        bike.update(dt, input, this.trails, true);
      } else {
        // Remote players: interpolate from host state
        bike.deadReckon(dt, renderTick);
      }
    }

    // Power-up visual updates only (client doesn't run spawn/pickup logic)
    for (const pu of this.powerUps) {
      if (pu.active) pu.update(dt, this.elapsedTime);
    }

    this.hud.update(this.bikes, this.round.roundNumber, this.config.roundsToWin);
    this.minimap.update(this.bikes, this.powerUps);
    this.hud.updatePing(this.currentPing);

    // Ping host every 2s
    const now = performance.now();
    if (now - this.lastPingTime >= 2000) {
      this.lastPingTime = now;
      const peerIds = this.net.getPeerIds();
      if (peerIds.length > 0) {
        this.net.pingPeer(peerIds[0]).then(ms => {
          this.currentPing = ms;
        });
      }
    }
  }

  private handleNetState(state: NetGameState): void {
    // Bootstrap client tick from first host state (render one tick behind)
    if (!this.clientTickSynced && state.tick != null) {
      this.clientTick = state.tick - 1;
      this.clientTickAccumulator = 0;
      this.clientTickSynced = true;
    } else if (this.clientTickSynced && state.tick != null) {
      // Re-sync if client tick drifts too far from host (e.g. after countdown restart)
      const drift = state.tick - this.clientTick;
      if (drift > 10 || drift < -5) {
        console.debug(`[TRON-NET] Tick drift ${drift}, re-syncing`);
        this.clientTick = state.tick - 1;
        this.clientTickAccumulator = 0;
      }
    }

    // Unpack bike states from flat arrays: [x, z, y, angle, alive, vy, grounded, boostMeter, boosting, invulnerable, invulnerableTimer]
    for (let i = 0; i < this.bikes.length && i < state.bikes.length; i++) {
      const p = state.bikes[i];
      this.bikes[i].applyNetState({
        x: p[0],
        z: p[1],
        y: p[2],
        angle: p[3],
        alive: p[4] === 1,
        vy: p[5],
        grounded: p[6] === 1,
        boostMeter: p[7],
        boosting: p[8] === 1,
        invulnerable: p[9] === 1,
        invulnerableTimer: p[10] ?? 0,
        doubleJumpCooldown: p[11] ?? 0,
        tick: state.tick,
      });
    }

    // Full trail resync (if host included it)
    if (state.fullTrails) {
      for (let i = 0; i < this.bikes.length && i < state.fullTrails.length; i++) {
        if (this.bikes[i].isLocalPredicted) continue; // predicted bike generates trails locally
        const flat = state.fullTrails[i];
        const points: Array<{ x: number; y: number; z: number }> = [];
        for (let j = 0; j < flat.length; j += 3) {
          points.push({ x: flat[j], y: flat[j + 1], z: flat[j + 2] });
        }
        this.bikes[i].trail.replaceAll(points);
      }
    } else {
      // Unpack trail deltas from flat [x, y, z, x, y, z, ...]
      for (let i = 0; i < this.bikes.length && i < state.trailDeltas.length; i++) {
        if (this.bikes[i].isLocalPredicted) continue; // predicted bike generates trails locally
        const flat = state.trailDeltas[i];
        if (flat.length > 0) {
          const points: Array<{ x: number; y: number; z: number }> = [];
          for (let j = 0; j < flat.length; j += 3) {
            points.push({ x: flat[j], y: flat[j + 1], z: flat[j + 2] });
          }
          this.bikes[i].trail.addPoints(points);
        }
      }
    }

    // Trail integrity check
    if (state.trailLengths) {
      for (let i = 0; i < this.bikes.length && i < state.trailLengths.length; i++) {
        if (this.bikes[i].isLocalPredicted) continue;
        const expected = state.trailLengths[i];
        const actual = this.bikes[i].trail.points.length;
        if (expected - actual > 5) {
          console.warn(`Trail desync bike ${i}: expected ${expected} points, have ${actual}`);
        }
      }
    }
  }

  private handleNetEvent(event: NetEvent): void {
    switch (event.type) {
      case 'countdown':
        this.state = 'COUNTDOWN';
        this.countdownTimer = COUNTDOWN_DURATION;
        this.countdownEl.style.display = 'block';
        break;

      case 'round-start':
        // Host initiated a new round — reset bikes
        this.disposePowerUps();
        this.scoreboard.hideAll();
        this.round.roundNumber = event.round ?? this.round.roundNumber;
        for (const bike of this.bikes) {
          const spawn = this.getSpawnForSlot(bike.playerIndex);
          bike.reset(spawn.x, spawn.z, spawn.angle);
        }
        this.state = 'COUNTDOWN';
        this.countdownTimer = COUNTDOWN_DURATION;
        this.countdownEl.style.display = 'block';
        this.lastBroadcastTrailLen = new Array(this.bikes.length).fill(0);
        // Reset tick tracking so clientTick re-syncs from next state
        this.clientTick = 0;
        this.clientTickAccumulator = 0;
        this.clientTickSynced = false;

        const localSlot = this.config.localSlot;
        this.hud.show(
          this.bikes.length,
          this.round.roundNumber,
          this.config.roundsToWin,
          this.bikes.findIndex(b => b.playerIndex === localSlot),
          true,
        );
        break;

      case 'round-end':
        this.state = 'ROUND_END';
        this.hud.hide();
        if (event.scores) {
          this.round.scores = event.scores;
        }
        this.scoreboard.showRoundEnd(
          event.winnerIndex ?? -1,
          this.round.scores,
          this.round.roundNumber,
          () => {}, // client doesn't control advancement
          true, // isOnlineClient
        );
        break;

      case 'game-over':
        this.state = 'GAME_OVER';
        this.hud.hide();
        if (event.scores) {
          this.round.scores = event.scores;
        }
        this.scoreboard.showGameOver(
          event.winnerIndex ?? -1,
          () => {
            // Play again — host will send new start
            this.scoreboard.hideAll();
          },
          () => {
            // Main menu
            this.scoreboard.hideAll();
            this.net.leaveRoom();
            this.cleanupBikes();
            this.state = 'MENU';
            this.menu.show();
          },
        );
        break;

      case 'powerup-spawn':
        if (event.powerupX != null && event.powerupZ != null && event.powerupId != null) {
          const puType = (event.powerupType as PowerUpType) || 'invulnerability';
          const pu = new PowerUp(event.powerupId, puType, event.powerupX, event.powerupZ, this.ctx.scene);
          this.powerUps.push(pu);
        }
        break;

      case 'powerup-pickup':
        if (event.powerupId != null) {
          const pu = this.powerUps.find(p => p.id === event.powerupId);
          if (pu?.active) pu.collect();
        }
        if (event.bikeIndex != null) {
          const bike = this.bikes.find(b => b.playerIndex === event.bikeIndex);
          if (bike) {
            bike.grantInvulnerability();
          }
        }
        break;

      case 'trail-destroy':
        if (event.trailIndex != null && event.destroyX != null && event.destroyZ != null && event.destroyRadius != null) {
          if (event.trailIndex >= 0 && event.trailIndex < this.trails.length) {
            this.trails[event.trailIndex].deleteSegmentsInRadius(event.destroyX, event.destroyZ, event.destroyRadius);
          }
        }
        break;
    }
  }

  private getSpawnForSlot(slot: number): { x: number; z: number; angle: number } {
    return SPAWN_POSITIONS[slot] || SPAWN_POSITIONS[0];
  }

  // --- Round End Check (host & local) ---

  private checkRoundEnd(): void {
    const { ended, winnerIndex } = this.round.checkRoundEnd(this.bikes);
    if (!ended) return;

    this.state = 'ROUND_END';
    this.hud.hide();
    this.minimap.hide();
    this.touchControls.hide();

    // Broadcast round-end to clients
    if (this.config.mode === 'online' && this.net.isHost) {
      this.net.broadcastEvent({
        type: 'round-end',
        winnerIndex,
        scores: [...this.round.scores],
        round: this.round.roundNumber,
      });
    }

    const gameWinner = this.round.getWinner(this.config.roundsToWin);
    if (gameWinner >= 0) {
      // Broadcast game-over
      if (this.config.mode === 'online' && this.net.isHost) {
        setTimeout(() => {
          this.net.broadcastEvent({
            type: 'game-over',
            winnerIndex: gameWinner,
            scores: [...this.round.scores],
          });
        }, 1500);
      }

      setTimeout(() => {
        this.state = 'GAME_OVER';
        this.scoreboard.showGameOver(
          gameWinner,
          () => {
            if (this.config.mode === 'online') {
              // Online: go back to lobby
              this.scoreboard.hideAll();
              this.cleanupBikes();
              this.handleLobbyStart(); // Restart the game
            } else {
              this.startGame(this.config);
            }
          },
          () => {
            this.scoreboard.hideAll();
            if (this.config.mode === 'online') {
              this.net.leaveRoom();
            }
            this.cleanupBikes();
            this.state = 'MENU';
            this.menu.show();
          },
        );
      }, 1500);
    } else {
      setTimeout(() => {
        const isOnlineClient = this.config.mode === 'online' && !this.net.isHost;
        this.scoreboard.showRoundEnd(
          winnerIndex,
          this.round.scores,
          this.round.roundNumber,
          () => this.startRound(),
          isOnlineClient,
        );
      }, 1500);
    }
  }

  // --- Power-Up Management ---

  private updatePowerUps(dt: number): void {
    // Update visuals (all modes)
    for (const pu of this.powerUps) {
      if (pu.active) pu.update(dt, this.elapsedTime);
    }

    // Only host/local runs spawn and pickup logic
    const isAuthoritative = this.config.mode !== 'online' || this.net.isHost;
    if (!isAuthoritative) return;

    // Spawn timer
    this.powerUpSpawnTimer += dt;
    const activeCount = this.powerUps.filter(p => p.active).length;
    if (activeCount < POWERUP_MAX_ACTIVE && this.powerUpSpawnTimer >= POWERUP_SPAWN_INTERVAL) {
      this.powerUpSpawnTimer = 0;
      this.spawnPowerUp();
    }

    // Pickup check
    for (const bike of this.bikes) {
      if (!bike.alive) continue;
      for (const pu of this.powerUps) {
        if (!pu.active) continue;
        if (pu.checkPickup(bike.position.x, bike.position.z)) {
          pu.collect();
          bike.grantInvulnerability();

          // Broadcast pickup event
          if (this.config.mode === 'online' && this.net.isHost) {
            this.net.broadcastEvent({
              type: 'powerup-pickup',
              powerupId: pu.id,
              bikeIndex: bike.playerIndex,
              powerupType: pu.type,
            });
          }
          break;
        }
      }
    }

    // Trail destruction from invulnerable bikes
    for (const bike of this.bikes) {
      if (bike.lastTrailDestruction) {
        const hit = bike.lastTrailDestruction;
        bike.lastTrailDestruction = null;

        // Broadcast trail-destroy event
        if (this.config.mode === 'online' && this.net.isHost) {
          this.net.broadcastEvent({
            type: 'trail-destroy',
            trailIndex: hit.trailIndex,
            destroyX: hit.contactX,
            destroyZ: hit.contactZ,
            destroyRadius: TRAIL_DESTROY_RADIUS,
          });
        }

        // Reset trail broadcast tracking for the affected trail
        if (this.lastBroadcastTrailLen[hit.trailIndex] !== undefined) {
          this.lastBroadcastTrailLen[hit.trailIndex] = this.trails[hit.trailIndex]?.points.length ?? 0;
        }
        this.forceFullTrailResync = true;
      }
    }
  }

  private spawnPowerUp(): void {
    const pos = generateSpawnPosition();
    const id = this.nextPowerUpId++;
    const puType: PowerUpType = 'invulnerability';
    const pu = new PowerUp(id, puType, pos.x, pos.z, this.ctx.scene);
    this.powerUps.push(pu);

    // Broadcast spawn event
    if (this.config.mode === 'online' && this.net.isHost) {
      this.net.broadcastEvent({
        type: 'powerup-spawn',
        powerupId: id,
        powerupX: pos.x,
        powerupZ: pos.z,
        powerupType: puType,
      });
    }
  }

  private disposePowerUps(): void {
    for (const pu of this.powerUps) {
      pu.dispose(this.ctx.scene);
    }
    this.powerUps = [];
    this.nextPowerUpId = 0;
    this.powerUpSpawnTimer = 0;
    this.forceFullTrailResync = false;
  }

  // --- Disconnect Handling ---

  private handlePeerDisconnect(peerId: string): void {
    if (this.config?.mode !== 'online') return;

    if (this.net.isHost) {
      // Host: mark disconnected peer's bike as dead
      const slot = this.net.getPeerSlot(peerId);
      if (slot >= 0) {
        const bike = this.bikes.find(b => b.playerIndex === slot);
        if (bike && bike.alive) {
          bike.alive = false;
          bike.mesh.visible = false;
        }
      }
    } else {
      // Client: host disconnected — show disconnect screen
      if (this.state === 'PLAYING' || this.state === 'COUNTDOWN') {
        this.state = 'MENU'; // Stop the game loop from updating
        this.hud.hide();
        this.countdownEl.style.display = 'none';
        document.getElementById('host-disconnected')!.style.display = 'block';
      }
    }
  }
}
