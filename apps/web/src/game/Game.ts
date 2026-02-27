import * as THREE from 'three';
import type { GameConfig, GameState, PlayerInput } from '@tron/shared';
import { PLAYER_COLORS, PLAYER_NAMES, COUNTDOWN_DURATION, MAX_PLAYERS } from '@tron/shared';
import { Simulation } from '@tron/game-core';
import { createSceneContext, SceneContext } from '../scene/SceneSetup';
import { GameCamera } from '../scene/Camera';
import { setupLighting } from '../scene/Lighting';
import { setupEnvironment, updateEnvironment } from '../scene/Environment';
import { Arena } from './Arena';
import { Bike } from './Bike';
import { Trail } from './Trail';
import { InputManager } from './Input';
import { Round } from './Round';
import { Menu } from '../ui/Menu';
import { HUD } from '../ui/HUD';
import { Scoreboard } from '../ui/Scoreboard';
import { ColyseusClient } from '../network/ColyseusClient';
import { Lobby } from '../ui/Lobby';
import { TouchControls } from '../ui/TouchControls';
import { Chat } from '../ui/Chat';
import { Minimap } from '../ui/Minimap';
import { PowerUpManager } from './PowerUpManager';

export class Game {
  private ctx: SceneContext;
  private gameCamera: GameCamera;
  private arena!: Arena;
  private bikes: Bike[] = [];
  private trails: Trail[] = [];
  private input: InputManager;
  private round!: Round;
  private state: GameState = 'MENU';
  private config!: GameConfig;
  private clock = new THREE.Clock();
  private countdownTimer = 0;
  private elapsedTime = 0;

  // Headless simulation (quickplay)
  private simulation: Simulation | null = null;

  // Network (Colyseus)
  private colyseus: ColyseusClient;
  private lobby: Lobby;
  private lastServerPhase = '';

  // Power-ups
  private powerUpManager!: PowerUpManager;

  // UI
  private menu: Menu;
  private hud: HUD;
  private scoreboard: Scoreboard;
  private countdownEl: HTMLElement;
  private touchControls: TouchControls;
  private chat: Chat;
  private minimap: Minimap;

  // Player names (indexed by bike order)
  private names: string[] = [];

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
    this.powerUpManager = new PowerUpManager(this.ctx.scene);

    // Network
    this.colyseus = new ColyseusClient();

    this.menu = new Menu(
      (config) => this.startGame(config),
      () => {
        // Online button clicked — show create/join
        this.lobby.showCreateJoin();
      },
    );

    this.lobby = new Lobby(
      this.colyseus,
      () => this.menu.getNickname(),
      () => this.handleLobbyStart(),
      () => {
        // Leave lobby — back to menu
        this.state = 'MENU';
        this.menu.show();
      },
    );

    // Colyseus event handlers
    this.colyseus.onStateChange = () => this.handleColyseusStateChange();
    this.colyseus.onChatReceived = (msg) => this.chat.addMessage(msg);
    this.colyseus.onPowerUpEvent = (event) => {
      if (this.config?.mode === 'online') {
        this.powerUpManager.handleNetEvent(event, this.bikes);
      }
    };
    this.colyseus.onDisconnect = () => {
      if (this.config?.mode !== 'online') return;
      if (this.state === 'PLAYING' || this.state === 'COUNTDOWN') {
        this.state = 'MENU';
        this.hud.hide();
        this.countdownEl.style.display = 'none';
        document.getElementById('host-disconnected')!.style.display = 'block';
      }
    };

    // Disconnected UI — back to menu
    document.getElementById('btn-dc-menu')!.addEventListener('click', () => {
      document.getElementById('host-disconnected')!.style.display = 'none';
      this.colyseus.leave();
      this.cleanupBikes();
      this.state = 'MENU';
      this.menu.show();
    });

    this.loop();
  }

  /** Copy server scores into the local round tracker. */
  private syncScoresFromServer(serverState: any): void {
    for (let i = 0; i < serverState.scores.length && i < this.round.scores.length; i++) {
      this.round.scores[i] = serverState.scores[i];
    }
  }

  /** Hide gameplay HUD elements (used on round/game end). */
  private hideGameplayUI(): void {
    this.hud.hide();
    this.minimap.hide();
    this.touchControls.hide();
  }

  // --- Colyseus State Handling ---

  private handleColyseusStateChange(): void {
    // Update lobby UI if visible
    this.lobby.refresh();

    // Handle online game phase transitions
    const roomState = this.colyseus.room?.state as any;
    if (!roomState) return;

    const serverPhase = roomState.phase as string;
    if (serverPhase !== this.lastServerPhase) {
      this.handleServerPhaseChange(serverPhase, roomState);
    }
  }

  private handleServerPhaseChange(phase: string, serverState: any): void {
    const prevPhase = this.lastServerPhase;
    this.lastServerPhase = phase;

    switch (phase) {
      case 'countdown': {
        if (prevPhase === 'lobby' || prevPhase === '') {
          // First game start — create bikes and enter game
          this.initOnlineGame(serverState);
        } else if (prevPhase === 'roundEnd') {
          // New round
          this.startOnlineRound(serverState);
        }
        this.state = 'COUNTDOWN';
        this.countdownTimer = COUNTDOWN_DURATION;
        this.countdownEl.style.display = 'block';
        break;
      }

      case 'playing': {
        this.countdownEl.style.display = 'none';
        this.state = 'PLAYING';
        break;
      }

      case 'roundEnd': {
        if (this.state === 'ROUND_END') break; // Already handled
        this.state = 'ROUND_END';
        this.hideGameplayUI();

        this.syncScoresFromServer(serverState);
        this.round.roundNumber = serverState.roundNumber;

        // Find round winner (last alive bike)
        let winnerIndex = -1;
        for (let i = 0; i < serverState.bikes.length; i++) {
          if (serverState.bikes[i].alive) {
            winnerIndex = serverState.bikes[i].slot;
            break;
          }
        }

        this.scoreboard.showRoundEnd(
          winnerIndex,
          this.round.scores,
          this.round.roundNumber,
          () => {}, // Server controls round advancement
          true, // isOnlineClient
          this.names,
        );
        break;
      }

      case 'gameOver': {
        this.state = 'GAME_OVER';
        this.hideGameplayUI();

        this.syncScoresFromServer(serverState);

        // Find game winner (highest score)
        let gameWinner = -1;
        let maxScore = 0;
        for (let i = 0; i < this.round.scores.length; i++) {
          if (this.round.scores[i] > maxScore) {
            maxScore = this.round.scores[i];
            gameWinner = i;
          }
        }

        this.scoreboard.showGameOver(
          gameWinner,
          () => {
            // Play again
            this.scoreboard.hideAll();
            if (this.colyseus.isHost) {
              this.colyseus.sendPlayAgain();
            }
          },
          () => {
            // Main menu
            this.scoreboard.hideAll();
            this.colyseus.leave();
            this.cleanupBikes();
            this.lastServerPhase = '';
            this.state = 'MENU';
            this.menu.show();
          },
          this.names,
        );
        break;
      }
    }
  }

  // --- Online Game Init ---

  private initOnlineGame(serverState: any): void {
    this.lobby.hide();
    this.menu.hide();
    this.scoreboard.hideAll();
    this.cleanupBikes();

    const localSlot = this.colyseus.getLocalSlot();
    const totalPlayers = serverState.bikes.length;

    this.config = {
      humanCount: serverState.players.size,
      aiCount: serverState.aiCount,
      aiDifficulty: serverState.aiDifficulty,
      roundsToWin: serverState.roundsToWin,
      mode: 'online',
      localSlot,
    };

    // Create visual bikes from schema
    for (let i = 0; i < totalPlayers; i++) {
      const schemaBike = serverState.bikes[i];
      const slot = schemaBike.slot;
      const bike = new Bike(
        slot,
        PLAYER_COLORS[slot],
        schemaBike.x, schemaBike.z, schemaBike.angle,
        this.ctx.scene,
      );
      this.bikes.push(bike);
      this.trails.push(bike.trail);
    }

    this.round = new Round();

    // Camera — always chase cam for online
    const localBikeIdx = this.bikes.findIndex(b => b.playerIndex === localSlot);
    this.gameCamera.setLocalBikeIndex(localBikeIdx >= 0 ? localBikeIdx : 0);
    this.gameCamera.setMode('chase');

    // Build names
    this.names = this.buildNames();

    // Chat
    this.chat.show(
      this.names[localBikeIdx >= 0 ? localBikeIdx : 0],
      PLAYER_COLORS[localSlot],
      (msg) => this.colyseus.sendChat(msg.text),
    );

    // HUD
    this.hud.show(
      this.bikes.length,
      serverState.roundNumber,
      serverState.roundsToWin,
      localBikeIdx >= 0 ? localBikeIdx : undefined,
      true,
      this.names,
    );
    this.minimap.show(localBikeIdx >= 0 ? localBikeIdx : 0);
    this.touchControls.show();
  }

  private startOnlineRound(serverState: any): void {
    this.powerUpManager.reset();
    this.scoreboard.hideAll();

    // Reset bikes from server positions
    for (let i = 0; i < this.bikes.length && i < serverState.bikes.length; i++) {
      const sb = serverState.bikes[i];
      this.bikes[i].reset(sb.x, sb.z, sb.angle);
    }

    this.round.roundNumber = serverState.roundNumber;

    const localSlot = this.config.localSlot;
    const localBikeIdx = this.bikes.findIndex(b => b.playerIndex === localSlot);
    this.hud.show(
      this.bikes.length,
      serverState.roundNumber,
      this.config.roundsToWin,
      localBikeIdx >= 0 ? localBikeIdx : undefined,
      true,
      this.names,
    );
    this.minimap.show(localBikeIdx >= 0 ? localBikeIdx : 0);
    this.touchControls.show();
  }

  // --- Lobby / Online Flow ---

  private handleLobbyStart(): void {
    // Host clicks Start in lobby
    if (!this.colyseus.isHost) return;
    this.colyseus.sendStartGame();
    // Server will change phase to 'countdown', triggering initOnlineGame via onStateChange
  }

  /** Build names array from server state (online) or nickname + defaults (quickplay). */
  private buildNames(): string[] {
    const names: string[] = [];
    if (this.config?.mode === 'online') {
      const lobbyState = this.colyseus.getLobbyState();
      const nameBySlot = new Map<number, string>();
      for (const p of lobbyState.players) {
        if (p.name) nameBySlot.set(p.slot, p.name);
      }
      for (let i = 0; i < this.bikes.length; i++) {
        const slot = this.bikes[i].playerIndex;
        names.push(nameBySlot.get(slot) || PLAYER_NAMES[slot]);
      }
    } else {
      // Quickplay: slot 0 = local human
      const nickname = this.menu.getNickname();
      for (let i = 0; i < this.bikes.length; i++) {
        const slot = this.bikes[i].playerIndex;
        names.push(slot === 0 && nickname ? nickname : PLAYER_NAMES[slot]);
      }
    }
    return names;
  }

  // --- Game Start (Quickplay) ---

  private startGame(config: GameConfig): void {
    this.config = config;
    this.menu.hide();
    this.scoreboard.hideAll();

    // Clean up old bikes
    this.cleanupBikes();

    const totalPlayers = config.humanCount + config.aiCount;

    // Quickplay mode — create headless simulation
    this.simulation = new Simulation({
      playerCount: totalPlayers,
      aiCount: config.aiCount,
      aiDifficulty: config.aiDifficulty,
      roundsToWin: config.roundsToWin,
      humanSlots: Array.from({ length: config.humanCount }, (_, i) => i),
    });

    // Create visual bikes (rendering only — simulation handles physics)
    for (let i = 0; i < totalPlayers; i++) {
      const bike = new Bike(
        i,
        PLAYER_COLORS[i],
        0, 0, 0,
        this.ctx.scene,
      );
      this.bikes.push(bike);
      this.trails.push(bike.trail);
    }

    this.round = new Round();

    // Camera mode
    const localSlot = config.localSlot ?? 0;
    const localBikeIdx = this.bikes.findIndex(b => b.playerIndex === localSlot);
    this.gameCamera.setLocalBikeIndex(localBikeIdx >= 0 ? localBikeIdx : 0);

    if (config.humanCount === 1) {
      this.gameCamera.setMode('chase');
    } else {
      this.gameCamera.setMode('overview');
    }

    this.startRound();
  }

  private startRound(): void {
    this.powerUpManager.reset();

    if (this.simulation) {
      this.simulation.startRound();
      // Sync visual bikes from simulation spawn positions
      for (let i = 0; i < this.bikes.length; i++) {
        const sim = this.simulation.bikes[i];
        this.bikes[i].reset(sim.position.x, sim.position.z, sim.angle);
      }
      this.round.roundNumber = this.simulation.round.roundNumber;
    } else {
      this.round.startRound(this.bikes);
    }
    this.state = 'COUNTDOWN';
    this.countdownTimer = COUNTDOWN_DURATION;
    this.countdownEl.style.display = 'block';

    const localBikeIdx = this.bikes.findIndex(b => b.playerIndex === (this.config.localSlot ?? 0));

    this.names = this.buildNames();
    this.hud.show(
      this.bikes.length,
      this.round.roundNumber,
      this.config.roundsToWin,
      localBikeIdx >= 0 ? localBikeIdx : 0,
      false,
      this.names,
    );

    // Show minimap
    this.minimap.show(localBikeIdx >= 0 ? localBikeIdx : 0);

    // Show touch controls during gameplay
    this.touchControls.show();
  }

  private cleanupBikes(): void {
    for (const bike of this.bikes) {
      bike.dispose(this.ctx.scene);
    }
    this.bikes = [];
    this.trails = [];
    this.simulation = null;
    this.powerUpManager.dispose();
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
      case 'COUNTDOWN': {
        this.countdownTimer -= dt;
        const display = Math.ceil(this.countdownTimer);
        this.countdownEl.textContent = display > 0 ? String(display) : 'GO!';

        if (this.countdownTimer <= -0.5) {
          this.countdownEl.style.display = 'none';
          this.state = 'PLAYING';
        }
        break;
      }

      case 'PLAYING':
        if (this.config.mode === 'online') {
          this.updatePlayingOnline(dt);
        } else {
          this.updatePlayingLocal(dt);
        }
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
    if (!this.simulation) return;

    // Gather human input
    const inputs = new Map<number, PlayerInput>();
    for (const bike of this.bikes) {
      if (!this.simulation.aiControllers.has(bike.playerIndex)) {
        inputs.set(bike.playerIndex, this.input.getInput(bike.playerIndex));
      }
    }

    // Tick headless simulation
    const result = this.simulation.tick(dt, inputs);

    // Sync visual bikes from simulation
    for (let i = 0; i < this.bikes.length; i++) {
      this.bikes[i].syncFromSim(this.simulation.bikes[i], dt);
    }

    // Handle powerup visual events (spawn/pickup)
    for (const event of result.powerUpEvents) {
      if (event.type === 'powerup-spawn' || event.type === 'powerup-pickup') {
        this.powerUpManager.handleNetEvent(event, this.bikes);
      }
    }

    // Update power-up visuals only (animations — logic is in simulation)
    this.powerUpManager.update(dt, this.elapsedTime, this.bikes, this.trails, false, null, []);

    // Sync round state from simulation
    this.round.scores = [...this.simulation.round.scores];

    this.hud.update(this.bikes, this.round.roundNumber, this.config.roundsToWin);
    this.minimap.update(this.bikes, this.powerUpManager.allPowerUps);

    if (result.roundEnded) {
      this.handleRoundEnd(result.winnerIndex);
    }
  }

  // --- Online Update ---

  private updatePlayingOnline(dt: number): void {
    // Send local player input to server
    const input = this.input.getInput(0);
    this.colyseus.sendInput(input);

    // Read server state
    const roomState = this.colyseus.room?.state as any;
    if (!roomState) return;

    // Sync visual bikes from schema
    for (let i = 0; i < this.bikes.length && i < roomState.bikes.length; i++) {
      this.bikes[i].syncFromServer(roomState.bikes[i], dt);
    }

    // Update power-up visuals (spawning/pickup handled via broadcast messages)
    this.powerUpManager.update(dt, this.elapsedTime, this.bikes, this.trails, false, null, []);

    this.syncScoresFromServer(roomState);
    this.hud.update(this.bikes, roomState.roundNumber, roomState.roundsToWin);
    this.minimap.update(this.bikes, this.powerUpManager.allPowerUps);
  }

  // --- Round End (Quickplay) ---

  private handleRoundEnd(winnerIndex: number): void {
    this.state = 'ROUND_END';
    this.hideGameplayUI();

    const gameWinner = this.round.getWinner(this.config.roundsToWin);
    if (gameWinner >= 0) {
      setTimeout(() => {
        this.state = 'GAME_OVER';
        this.scoreboard.showGameOver(
          gameWinner,
          () => {
            this.startGame(this.config);
          },
          () => {
            this.scoreboard.hideAll();
            this.cleanupBikes();
            this.state = 'MENU';
            this.menu.show();
          },
          this.names,
        );
      }, 1500);
    } else {
      setTimeout(() => {
        this.scoreboard.showRoundEnd(
          winnerIndex,
          this.round.scores,
          this.round.roundNumber,
          () => this.startRound(),
          false,
          this.names,
        );
      }, 1500);
    }
  }
}
