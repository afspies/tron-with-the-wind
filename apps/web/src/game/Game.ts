import * as THREE from 'three';
import type { GameConfig, GameState, PlayerInput } from '@tron/shared';
import {
  PLAYER_COLORS, PLAYER_NAMES, COUNTDOWN_DURATION,
  NET_TICK_DURATION_MS, FIXED_SIM_DT_SEC, INPUT_HISTORY_MAX,
  REMOTE_TICK_CORRECTION_RATE, REMOTE_TICK_SNAP_THRESHOLD,
  RENDER_OFFSET_SNAP_THRESHOLD,
  wrapAngle,
} from '@tron/shared';
import { Simulation, SimBike as SimBikeClass, SimTrail } from '@tron/game-core';
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
import { Settings } from '../ui/Settings';
import { PowerUpManager } from './PowerUpManager';
import { TutorialManager } from '../ui/Tutorial';
import { Stadium } from './Stadium';
import { Crowd } from './Crowd';
import { NetDebugOverlay } from './NetDebugOverlay';

// Scratch allocations for the reconciler hot path.
const _preRewindPos = new THREE.Vector3();
const _postRewindPos = new THREE.Vector3();
const _preRewindQuat = new THREE.Quaternion();
const _postRewindQuat = new THREE.Quaternion();

/** Build a net state snapshot from a Colyseus schema bike + room tick. */
function netStateFromSchema(sb: any, tick: number) {
  return {
    x: sb.x as number, z: sb.z as number, y: sb.y as number, angle: sb.angle as number,
    alive: sb.alive as boolean, vy: sb.vy as number, grounded: sb.grounded as boolean,
    boostMeter: sb.boostMeter as number, boosting: sb.boosting as boolean,
    invulnerable: sb.invulnerable as boolean, invulnerableTimer: sb.invulnerableTimer as number,
    doubleJumpCooldown: sb.doubleJumpCooldown as number,
    drifting: sb.drifting as boolean, velocityAngle: sb.velocityAngle as number,
    pitch: sb.pitch as number, flying: sb.flying as boolean,
    surfaceType: sb.surfaceType as number,
    forwardX: sb.forwardX as number, forwardY: sb.forwardY as number, forwardZ: sb.forwardZ as number,
    vx: sb.vx as number, vz: sb.vz as number,
    tick,
  };
}

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
  private roundEndTimeout: ReturnType<typeof setTimeout> | null = null;
  private rPressed = false; // edge-detect for R key restart

  // Headless simulation (quickplay)
  private simulation: Simulation | null = null;

  // Client-side prediction SimBike (online mode)
  private localSimBike: SimBikeClass | null = null;
  private predictionAccumulator: number = 0;

  // Valve-style input replay: ring buffer of every input sent, keyed by seq.
  // On each new server tick that acks a new inputSeq, we rewind the predicted
  // bike to the server snapshot, drop acked inputs, and replay the rest.
  private inputHistory: Array<{ seq: number; input: PlayerInput; sendTimeMs: number }> = [];
  private lastAckedInputSeq: number = 0;

  /** Telemetry bag consumed by the dev NetDebugOverlay. Reset every new tick. */
  netStats = {
    frameDtMs: 0,
    serverTickDtMs: 0,
    lastServerTickAtMs: 0,
    rttMs: 0,
    reconcileErrorM: 0,
    reconcileSnaps: 0,
    reconcileApplies: 0,
    renderOffsetMag: 0,
    inputHistoryLen: 0,
    replaySteps: 0,
    localTick: 0,
    serverTick: 0,
  };

  // Network (Colyseus)
  private colyseus: ColyseusClient;
  private lobby: Lobby;
  private lastServerPhase = '';
  private lastServerTick = 0;
  private remoteRenderTick = 0;

  // Power-ups
  private powerUpManager!: PowerUpManager;

  // Tutorial
  private tutorial: TutorialManager;

  // Stadium & crowd
  private stadium!: Stadium;
  private crowd!: Crowd;

  // UI
  private settings: Settings;
  private menu: Menu;
  private hud: HUD;
  private scoreboard: Scoreboard;
  private countdownEl: HTMLElement;
  private touchControls: TouchControls;
  private chat: Chat;
  private minimap: Minimap;

  // Player names (indexed by bike order)
  private names: string[] = [];

  // Dev-only net debug HUD (toggle with backtick)
  private netDebug = new NetDebugOverlay();

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
    this.stadium = new Stadium(this.ctx.scene);
    this.crowd = new Crowd(this.ctx.scene);

    // Network
    this.colyseus = new ColyseusClient();

    this.tutorial = new TutorialManager();
    this.settings = new Settings(() => this.menu.show());

    this.menu = new Menu(
      (config) => this.startGame(config),
      () => this.lobby.showCreateJoin(),
      () => this.startTutorial(),
      () => this.settings.show(),
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

    // Check for ?room=WORD share link
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room');
    if (roomCode) {
      history.replaceState(null, '', window.location.pathname);
      document.getElementById('menu')!.style.display = 'none';
      this.lobby.autoJoin(roomCode);
    }

    this.loop();
  }

  /** Find the bikes array index for the local player slot, defaulting to 0. */
  private get localBikeIndex(): number {
    const slot = this.config?.localSlot ?? 0;
    const idx = this.bikes.findIndex(b => b.playerIndex === slot);
    return idx >= 0 ? idx : 0;
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

  /** Cancel any pending round-end timeout to prevent stale callbacks. */
  private clearPendingRoundEnd(): void {
    if (this.roundEndTimeout !== null) {
      clearTimeout(this.roundEndTimeout);
      this.roundEndTimeout = null;
    }
  }

  /** Reset all gameplay UI and return to the main menu. */
  private exitToMenu(): void {
    this.tutorial.hide();
    document.getElementById('tutorial-complete-msg')!.style.display = 'none';
    this.scoreboard.hideAll();
    this.countdownEl.style.display = 'none';
    this.hideGameplayUI();
    this.cleanupBikes();
    this.state = 'MENU';
    this.menu.show();
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
    this.settings.hide();
    this.scoreboard.hideAll();
    this.cleanupBikes();
    this.lastServerTick = 0;
    this.remoteRenderTick = 0;
    this.inputHistory.length = 0;
    this.lastAckedInputSeq = 0;
    this.colyseus.resetInputSeq();

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
      if (slot === localSlot) {
        bike.isLocalPredicted = true;
        // Create local SimBike for 3D client prediction
        this.localSimBike = new SimBikeClass(slot, PLAYER_COLORS[slot], schemaBike.x, schemaBike.z, schemaBike.angle);
        this.predictionAccumulator = 0;
      }
      this.bikes.push(bike);
      this.trails.push(bike.trail);
    }

    this.round = new Round();

    this.gameCamera.setLocalBikeIndex(this.localBikeIndex);
    this.gameCamera.setMode('chase');

    this.names = this.buildNames();

    this.chat.show(
      this.names[this.localBikeIndex],
      PLAYER_COLORS[localSlot],
      (msg) => this.colyseus.sendChat(msg.text),
    );

    this.hud.show(
      this.bikes.length,
      serverState.roundNumber,
      serverState.roundsToWin,
      this.localBikeIndex,
      true,
      this.names,
    );
    this.minimap.show(this.localBikeIndex);
    this.touchControls.show();
  }

  private startOnlineRound(serverState: any): void {
    this.powerUpManager.reset();
    this.scoreboard.hideAll();
    this.remoteRenderTick = 0;
    this.inputHistory.length = 0;
    this.lastAckedInputSeq = 0;
    this.colyseus.resetInputSeq();

    // Reset bikes from server positions
    for (let i = 0; i < this.bikes.length && i < serverState.bikes.length; i++) {
      const sb = serverState.bikes[i];
      this.bikes[i].reset(sb.x, sb.z, sb.angle);
    }

    // Reset local SimBike for prediction
    if (this.localSimBike) {
      const localSlot = this.config.localSlot;
      const localSb = serverState.bikes.find((b: any) => b.slot === localSlot);
      if (localSb) {
        this.localSimBike.reset(localSb.x, localSb.z, localSb.angle);
        this.predictionAccumulator = 0;
      }
    }

    this.round.roundNumber = serverState.roundNumber;

    this.hud.show(
      this.bikes.length,
      serverState.roundNumber,
      this.config.roundsToWin,
      this.localBikeIndex,
      true,
      this.names,
    );
    this.minimap.show(this.localBikeIndex);
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
    this.clearPendingRoundEnd();
    this.config = config;
    this.menu.hide();
    this.settings.hide();
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

    this.gameCamera.setLocalBikeIndex(this.localBikeIndex);
    this.gameCamera.setMode(config.humanCount === 1 ? 'chase' : 'overview');

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

    this.names = this.buildNames();
    this.hud.show(
      this.bikes.length,
      this.round.roundNumber,
      this.config.roundsToWin,
      this.localBikeIndex,
      false,
      this.names,
    );
    this.minimap.show(this.localBikeIndex);
    this.touchControls.show();
  }

  // --- Tutorial ---

  private startTutorial(): void {
    this.clearPendingRoundEnd();
    this.config = {
      humanCount: 1,
      aiCount: 1,
      aiDifficulty: 'easy',
      roundsToWin: 999,
      mode: 'tutorial',
    };

    this.menu.hide();
    this.scoreboard.hideAll();
    this.cleanupBikes();

    this.tutorial.onSkip = () => {
      if (this.tutorial.isLastStep) {
        this.handleTutorialComplete();
      } else {
        this.advanceTutorialStep();
      }
    };
    this.tutorial.startStep(0);
    this.setupTutorialSimulation();
    this.tutorial.show();
  }

  private setupTutorialSimulation(): void {
    const stepConfig = this.tutorial.getCurrentStepConfig();
    const totalPlayers = 1 + stepConfig.aiCount;

    // Clean up old sim + bikes
    if (this.simulation) {
      for (const bike of this.bikes) bike.dispose(this.ctx.scene);
      this.bikes = [];
      this.trails = [];
      this.simulation = null;
    }
    this.powerUpManager.reset();

    this.simulation = new Simulation({
      playerCount: totalPlayers,
      aiCount: stepConfig.aiCount,
      aiDifficulty: 'easy',
      roundsToWin: 999,
      humanSlots: [0],
    });

    for (let i = 0; i < totalPlayers; i++) {
      const bike = new Bike(i, PLAYER_COLORS[i], 0, 0, 0, this.ctx.scene);
      this.bikes.push(bike);
      this.trails.push(bike.trail);
    }

    this.round = new Round();
    this.simulation.startRound();

    // Sync visual bikes from sim spawn positions
    for (let i = 0; i < this.bikes.length; i++) {
      const sim = this.simulation.bikes[i];
      this.bikes[i].reset(sim.position.x, sim.position.z, sim.angle);
    }

    this.gameCamera.setLocalBikeIndex(0);
    this.gameCamera.setMode('chase');

    this.names = this.buildNames();
    this.hud.show(this.bikes.length, 1, 999, 0, false, this.names);
    this.minimap.show(0);
    this.touchControls.show();

    // Skip countdown — go straight to playing
    this.state = 'PLAYING';
    this.countdownEl.style.display = 'none';

    // Force-spawn power-up 30 units ahead of the player if step requires it.
    // Must spawn in both the simulation (for pickup detection) and the visual manager.
    if (stepConfig.spawnPowerUp) {
      const playerBike = this.simulation.bikes[0];
      const px = playerBike.position.x + Math.sin(playerBike.angle) * 30;
      const pz = playerBike.position.z + Math.cos(playerBike.angle) * 30;
      // Add to simulation's powerup system so pickup detection works
      this.simulation.powerUps.powerUps.push({
        id: 9000,
        type: 'invulnerability',
        x: px,
        z: pz,
        active: true,
      });
      // Create the visual power-up
      this.powerUpManager.handleNetEvent({
        type: 'powerup-spawn',
        powerupId: 9000,
        powerupX: px,
        powerupZ: pz,
        powerupType: 'invulnerability',
      }, this.bikes);
    }
  }

  private updatePlayingTutorial(dt: number): void {
    if (!this.simulation) return;

    const humanInput = this.input.getInput(0);
    const inputs = new Map<number, PlayerInput>([[0, humanInput]]);
    const result = this.simulation.tick(dt, inputs);

    // Sync visual bikes
    for (let i = 0; i < this.bikes.length; i++) {
      this.bikes[i].syncFromSim(this.simulation.bikes[i], dt);
    }

    // Handle power-up visual events
    for (const event of result.powerUpEvents) {
      if (event.type === 'powerup-spawn' || event.type === 'powerup-pickup') {
        this.powerUpManager.handleNetEvent(event, this.bikes);
      }
    }

    this.powerUpManager.update(dt, this.elapsedTime, this.bikes, this.trails, false, null, []);
    this.hud.update(this.bikes, 1, 999);
    this.minimap.update(this.bikes, this.powerUpManager.allPowerUps);

    // Tutorial state machine
    const tutEvent = this.tutorial.update(this.simulation.bikes[0], humanInput, dt);

    switch (tutEvent) {
      case 'player-died':
        this.respawnTutorialPlayer();
        break;
      case 'step-complete':
        this.advanceTutorialStep();
        break;
      case 'tutorial-complete':
        this.handleTutorialComplete();
        break;
    }
  }

  private respawnTutorialPlayer(): void {
    if (!this.simulation) return;
    // Reset all bikes and trails to prevent AI trail accumulation
    this.simulation.startRound();
    for (let i = 0; i < this.bikes.length; i++) {
      const sim = this.simulation.bikes[i];
      this.bikes[i].reset(sim.position.x, sim.position.z, sim.angle);
    }
    this.powerUpManager.reset();

    // Re-spawn power-up if step requires it
    const stepConfig = this.tutorial.getCurrentStepConfig();
    if (stepConfig.spawnPowerUp) {
      const playerBike = this.simulation.bikes[0];
      const px = playerBike.position.x + Math.sin(playerBike.angle) * 30;
      const pz = playerBike.position.z + Math.cos(playerBike.angle) * 30;
      this.simulation.powerUps.powerUps.push({
        id: 9000,
        type: 'invulnerability',
        x: px,
        z: pz,
        active: true,
      });
      this.powerUpManager.handleNetEvent({
        type: 'powerup-spawn',
        powerupId: 9000,
        powerupX: px,
        powerupZ: pz,
        powerupType: 'invulnerability',
      }, this.bikes);
    }
  }

  private advanceTutorialStep(): void {
    this.tutorial.startStep(this.tutorial.stepIndex + 1);
    this.setupTutorialSimulation();
    this.tutorial.show();
  }

  private handleTutorialComplete(): void {
    this.tutorial.hide();
    this.hideGameplayUI();
    this.state = 'GAME_OVER'; // Reuse GAME_OVER state to block gameplay

    const completeEl = document.getElementById('tutorial-complete-msg')!;
    completeEl.style.display = 'flex';

    document.getElementById('btn-tutorial-quickplay')!.onclick = () => {
      completeEl.style.display = 'none';
      this.cleanupBikes();
      this.startGame({
        humanCount: 1,
        aiCount: 3,
        aiDifficulty: 'medium',
        roundsToWin: 3,
        mode: 'quickplay',
      });
    };

    document.getElementById('btn-tutorial-menu')!.onclick = () => {
      completeEl.style.display = 'none';
      this.exitToMenu();
    };
  }

  private cleanupBikes(): void {
    for (const bike of this.bikes) {
      bike.dispose(this.ctx.scene);
    }
    this.bikes = [];
    this.trails = [];
    this.simulation = null;
    this.localSimBike = null;
    this.predictionAccumulator = 0;
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

    // ESC exits tutorial back to menu
    if (this.config?.mode === 'tutorial' && this.input.isKeyPressed('Escape') && this.state !== 'MENU') {
      this.exitToMenu();
      return;
    }

    // Quick restart (R key) in quickplay mode -- edge-detected
    const rDown = this.input.isKeyPressed('KeyR');
    const canQuickRestart = this.config?.mode === 'quickplay' && this.state !== 'MENU';
    if (canQuickRestart && rDown && !this.rPressed) {
      this.rPressed = rDown;
      this.scoreboard.hideAll();
      this.countdownEl.style.display = 'none';
      this.startGame(this.config);
      return;
    }
    this.rPressed = rDown;

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
        } else if (this.config.mode === 'tutorial') {
          this.updatePlayingTutorial(dt);
        } else {
          this.updatePlayingLocal(dt);
        }
        break;
    }

    // Always update camera and render
    this.gameCamera.update(dt, this.bikes);
    this.netDebug.update(this.netStats);

    // Hide local player's trail near the bike in first-person mode
    const fpBlend = this.gameCamera.fpBlendValue;
    if (this.bikes.length > 0 && fpBlend > 0) {
      const trail = this.bikes[this.localBikeIndex].trail;
      const totalSegs = trail.points.length - 1;
      if (totalSegs > 0) {
        const hideSegs = Math.round(8 * fpBlend);
        const visibleSegs = Math.max(0, totalSegs - hideSegs);
        trail.mesh.geometry.setDrawRange(0, visibleSegs * 6);
      }
    }

    this.crowd.update(dt, this.elapsedTime);
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

    // Detect deaths before syncing (compare old alive state to new)
    for (let i = 0; i < this.bikes.length; i++) {
      if (this.bikes[i].alive && !this.simulation.bikes[i].alive) {
        this.crowd.onDeath();
      }
    }

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

    this.updateTrailLiveHeads();

    if (result.roundEnded) {
      this.handleRoundEnd(result.winnerIndex);
    }
  }

  // --- Online Update ---

  private updatePlayingOnline(dt: number): void {
    this.netStats.frameDtMs = dt * 1000;

    // Sample input and ship it to the server. Record in the ring buffer so
    // the Valve-style reconciler can replay any inputs the server hasn't
    // acknowledged yet after we rewind to the authoritative snapshot.
    const input = this.input.getInput(0);
    const seq = this.colyseus.sendInput(input);
    this.inputHistory.push({ seq, input: { ...input }, sendTimeMs: performance.now() });
    if (this.inputHistory.length > INPUT_HISTORY_MAX) {
      this.inputHistory.splice(0, this.inputHistory.length - INPUT_HISTORY_MAX);
    }

    // Read server state
    const roomState = this.colyseus.room?.state as any;
    if (!roomState) return;

    const newTick = roomState.tick !== this.lastServerTick;
    if (newTick) {
      const nowMs = performance.now();
      if (this.netStats.lastServerTickAtMs > 0) {
        this.netStats.serverTickDtMs = nowMs - this.netStats.lastServerTickAtMs;
      }
      this.netStats.lastServerTickAtMs = nowMs;
      this.netStats.serverTick = roomState.tick;
      this.lastServerTick = roomState.tick;
    }
    this.netStats.inputHistoryLen = this.inputHistory.length;

    // Advance fractional render tick at frame rate, targeting one tick behind
    // the server so interpolation always has data ahead of the render point.
    const tickDurationSec = NET_TICK_DURATION_MS / 1000;
    this.remoteRenderTick += dt / tickDurationSec;
    if (newTick) {
      const targetTick = roomState.tick - 1;
      const drift = targetTick - this.remoteRenderTick;
      if (Math.abs(drift) > REMOTE_TICK_SNAP_THRESHOLD) {
        this.remoteRenderTick = targetTick;
      } else {
        this.remoteRenderTick += drift * REMOTE_TICK_CORRECTION_RATE;
      }
    }

    // Detect deaths before syncing
    for (let i = 0; i < this.bikes.length && i < roomState.bikes.length; i++) {
      if (this.bikes[i].alive && !roomState.bikes[i].alive) {
        this.crowd.onDeath();
      }
    }

    const localSlot = this.config.localSlot ?? 0;
    for (let i = 0; i < this.bikes.length && i < roomState.bikes.length; i++) {
      const bike = this.bikes[i];
      const sb = roomState.bikes[i];

      if (bike.playerIndex === localSlot && this.localSimBike) {
        // LOCAL: client-side prediction with fixed-dt stepping — matches the
        // server's fixed-dt loop so deterministic replay is valid.
        this.predictionAccumulator += dt;
        while (this.predictionAccumulator >= FIXED_SIM_DT_SEC) {
          this.localSimBike.update(FIXED_SIM_DT_SEC, input, [this.localSimBike.trail], false);
          this.predictionAccumulator -= FIXED_SIM_DT_SEC;
        }
        bike.syncFromSimPredicted(this.localSimBike, dt);
        if (newTick) {
          this.reconcileLocalBike(bike, this.localSimBike, sb, netStateFromSchema(sb, roomState.tick));
        }
        // Trail: sync from server when it grows beyond local prediction
        if (sb.trail.length > bike.trail.points.length) {
          this.syncTrailFromServer(bike, sb);
        }
      } else {
        // REMOTE: buffer states, interpolate with fractional render tick
        if (newTick) {
          bike.applyNetState(netStateFromSchema(sb, roomState.tick));
          this.syncTrailFromServer(bike, sb);
        }
        bike.deadReckon(dt, this.remoteRenderTick);
      }
    }

    // Update power-up visuals (spawning/pickup handled via broadcast messages)
    this.powerUpManager.update(dt, this.elapsedTime, this.bikes, this.trails, false, null, []);

    this.syncScoresFromServer(roomState);
    this.hud.update(this.bikes, roomState.roundNumber, roomState.roundsToWin);
    this.minimap.update(this.bikes, this.powerUpManager.allPowerUps);

    this.updateTrailLiveHeads();
  }

  /**
   * Reconcile the local predicted SimBike with the authoritative server
   * snapshot via Valve-style rewind + replay:
   *   1. Capture pre-rewind visual frame (pos + base orientation quat).
   *   2. Apply server state to SimBike (rewind).
   *   3. Drop acked inputs from the ring buffer.
   *   4. Replay unacked inputs at FIXED_SIM_DT_SEC each (skipCollision + skipTrail).
   *   5. Compute post-rewind frame and absorb the delta into the visual
   *      offsets so the rendered bike does not jump.
   */
  private reconcileLocalBike(
    bike: Bike,
    simBike: SimBikeClass,
    schemaBike: any,
    serverState: ReturnType<typeof netStateFromSchema>,
  ): void {
    // Death is always authoritative from server — check first
    if (!serverState.alive && bike.alive) {
      bike.applyNetState(serverState);
      simBike.applyServerState(serverState);
      bike.renderOffset.set(0, 0, 0);
      bike.renderAngleOffset = 0;
      bike.renderQuatOffset.identity();
      return;
    }

    if (!serverState.alive) return;

    // 1. Pre-rewind snapshot (physics-space — before we apply the server state).
    _preRewindPos.set(simBike.position.x, simBike.position.y, simBike.position.z);
    const preIsOnSurface = simBike.onSurface;
    const preAngle = simBike.angle;
    Bike.computeBaseQuat(simBike.forward, simBike.surfaceNormal, simBike.angle, preIsOnSurface, _preRewindQuat);

    // Update RTT estimate if the server has acked an input we remember.
    const ackedSeq = (schemaBike.lastInputSeq ?? 0) as number;
    if (ackedSeq > 0) {
      const match = this.inputHistory.find((h) => h.seq === ackedSeq);
      if (match) this.netStats.rttMs = performance.now() - match.sendTimeMs;
    }

    // 2. Rewind to server authoritative state.
    simBike.applyServerState(serverState);

    // 3. Drop inputs the server has already processed.
    if (ackedSeq > this.lastAckedInputSeq) {
      this.lastAckedInputSeq = ackedSeq;
    }
    if (this.lastAckedInputSeq > 0) {
      const drop = this.inputHistory.findIndex((h) => h.seq > this.lastAckedInputSeq);
      if (drop < 0) {
        this.inputHistory.length = 0;
      } else if (drop > 0) {
        this.inputHistory.splice(0, drop);
      }
    }

    // 4. Replay unacked inputs. skipCollision=true (server is authoritative on
    // death) and skipTrail=true (the trail already contains the points added
    // during the forward pass we are re-simulating).
    let replayed = 0;
    for (const h of this.inputHistory) {
      if (!simBike.alive) break;
      simBike.update(FIXED_SIM_DT_SEC, h.input, [simBike.trail], true, true);
      replayed++;
    }
    this.netStats.replaySteps = replayed;

    // 5. Post-rewind frame and delta absorption.
    _postRewindPos.set(simBike.position.x, simBike.position.y, simBike.position.z);
    const postIsOnSurface = simBike.onSurface;
    const postAngle = simBike.angle;
    Bike.computeBaseQuat(simBike.forward, simBike.surfaceNormal, simBike.angle, postIsOnSurface, _postRewindQuat);

    const result = bike.absorbReconcileDelta(
      _preRewindPos, _preRewindQuat, preAngle,
      _postRewindPos, _postRewindQuat, postAngle,
      RENDER_OFFSET_SNAP_THRESHOLD,
    );
    this.netStats.reconcileErrorM = result.errorMag;
    this.netStats.renderOffsetMag = bike.renderOffset.length();
    if (result.snapped) this.netStats.reconcileSnaps++;
    else this.netStats.reconcileApplies++;

    // Sync non-positional state to visual bike
    bike.syncInvulnerabilityFromNet(serverState.invulnerable, serverState.invulnerableTimer);
  }

  /** Connect each trail's live head segment to its bike's current render position. */
  private updateTrailLiveHeads(): void {
    for (const bike of this.bikes) {
      if (bike.alive) {
        const rp = bike.renderPosition;
        bike.trail.updateLiveHead(rp.x, rp.y, rp.z);
      } else {
        bike.trail.clearLiveHead();
      }
    }
  }

  private syncTrailFromServer(bike: Bike, schemaBike: any): void {
    const schemaTrailLen = schemaBike.trail.length;
    if (schemaTrailLen !== bike.trail.points.length) {
      const points: Array<{ x: number; y: number; z: number }> = [];
      for (const tp of schemaBike.trail) {
        points.push({ x: tp.x, y: tp.y, z: tp.z });
      }
      bike.trail.syncFromSimTrail(points);
    }
  }

  // --- Round End (Quickplay) ---

  private handleRoundEnd(winnerIndex: number): void {
    if (this.config?.mode === 'tutorial') return; // Tutorial handles its own lifecycle
    this.state = 'ROUND_END';
    this.hideGameplayUI();

    const gameWinner = this.round.getWinner(this.config.roundsToWin);
    if (gameWinner >= 0) {
      this.roundEndTimeout = setTimeout(() => {
        this.roundEndTimeout = null;
        this.state = 'GAME_OVER';
        this.scoreboard.showGameOver(
          gameWinner,
          () => {
            this.startGame(this.config);
          },
          () => this.exitToMenu(),
          this.names,
        );
      }, 1500);
    } else {
      this.roundEndTimeout = setTimeout(() => {
        this.roundEndTimeout = null;
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
