import { Room, Client } from 'colyseus';
import { Simulation } from '@tron/game-core';
import {
  COUNTDOWN_DURATION,
  PLAYER_NAMES,
  MAX_PLAYERS,
  ClientMsg,
  ServerMsg,
  unpackPlayerInput,
  toTrailPointWire,
  type BikeSnapshot,
  type GameEvent,
  type GameSnapshot,
  type InputFrame,
  type PlayerInput,
  type AIDifficulty,
} from '@tron/shared';
import {
  TronState, PlayerSchema, BikeSchema,
} from './schema/TronState';

const SIM_INTERVAL_MS = 33;   // 30 Hz physics

export class TronRoom extends Room<TronState> {
  maxClients = MAX_PLAYERS;
  patchRate = 250;             // Low-frequency room state; gameplay uses snapshots.

  private simulation: Simulation | null = null;
  private playerInputs = new Map<string, PlayerInput>();
  private sessionToSlot = new Map<string, number>();
  private lastTrailSentLength: number[] = [];
  private trailRevisions: number[] = [];
  private forceTrailReplace = new Set<number>();
  private deathSlotsThisRound = new Set<number>();
  private pendingEvents: GameEvent[] = [];

  onCreate(_options: { roomCode?: string }): void {
    this.setState(new TronState());
    this.autoDispose = true;

    this.onMessage(ClientMsg.Input, (client, data: InputFrame | PlayerInput) => {
      if (this.state.phase !== 'playing') return;
      this.playerInputs.set(client.sessionId, this.sanitizeInput(data));
    });

    this.onMessage(ClientMsg.Chat, (client, data: { text: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !data.text) return;
      this.broadcast(ServerMsg.Chat, {
        name: player.name,
        text: String(data.text).slice(0, 200),
      });
    });

    this.onMessage(ClientMsg.SetConfig, (client, data: { aiCount?: number; aiDifficulty?: string; roundsToWin?: number }) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.state.phase !== 'lobby') return;

      if (data.aiCount != null) {
        this.state.aiCount = Math.max(0, Math.min(3, data.aiCount));
      }
      if (data.aiDifficulty && ['easy', 'medium', 'hard'].includes(data.aiDifficulty)) {
        this.state.aiDifficulty = data.aiDifficulty;
      }
      if (data.roundsToWin != null) {
        this.state.roundsToWin = Math.max(1, Math.min(10, data.roundsToWin));
      }
    });

    this.onMessage(ClientMsg.StartGame, (client) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.state.phase !== 'lobby') return;
      this.startGame();
    });

    this.onMessage(ClientMsg.PlayAgain, (client) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.state.phase !== 'gameOver') return;
      this.startGame();
    });
  }

  onJoin(client: Client, options: { name?: string }): void {
    // Assign slot
    const usedSlots = new Set<number>();
    this.state.players.forEach(p => usedSlots.add(p.slot));

    let slot = -1;
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (!usedSlots.has(s)) { slot = s; break; }
    }
    if (slot < 0) return; // should not happen with maxClients=4

    const player = new PlayerSchema();
    player.sessionId = client.sessionId;
    player.slot = slot;
    player.name = options?.name || PLAYER_NAMES[slot];
    this.state.players.set(client.sessionId, player);
    this.sessionToSlot.set(client.sessionId, slot);

    // First player is host
    if (this.state.players.size === 1) {
      this.state.hostSessionId = client.sessionId;
    }
  }

  onLeave(client: Client): void {
    const slot = this.sessionToSlot.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.sessionToSlot.delete(client.sessionId);
    this.playerInputs.delete(client.sessionId);

    // Kill bike if playing
    if (this.simulation && slot != null) {
      const simBike = this.simulation.getBikeBySlot(slot);
      if (simBike?.alive) {
        simBike.alive = false;
      }
    }

    // Promote new host if needed
    if (client.sessionId === this.state.hostSessionId && this.state.players.size > 0) {
      const [firstPlayer] = this.state.players.values();
      if (firstPlayer) {
        this.state.hostSessionId = firstPlayer.sessionId;
      }
    }
  }

  private startGame(): void {
    const humanSlots: number[] = [];
    this.state.players.forEach(p => humanSlots.push(p.slot));

    const totalPlayers = humanSlots.length + this.state.aiCount;
    if (totalPlayers < 2) return;

    // Cap AI to fill remaining slots
    const maxAI = MAX_PLAYERS - humanSlots.length;
    const aiCount = Math.min(this.state.aiCount, maxAI);

    this.simulation = new Simulation({
      playerCount: totalPlayers,
      aiCount,
      aiDifficulty: this.state.aiDifficulty as AIDifficulty,
      roundsToWin: this.state.roundsToWin,
      humanSlots,
    });

    // Initialize schema bikes
    this.state.bikes.clear();
    this.state.scores.clear();
    for (const simBike of this.simulation.bikes) {
      const bikeSchema = new BikeSchema();
      bikeSchema.slot = simBike.playerIndex;
      this.state.bikes.push(bikeSchema);
    }
    for (let i = 0; i < MAX_PLAYERS; i++) {
      this.state.scores.push(0);
    }

    this.state.tick = 0;
    this.playerInputs.clear();
    this.lastTrailSentLength = new Array(this.simulation.bikes.length).fill(0);
    this.trailRevisions = new Array(this.simulation.bikes.length).fill(0);
    this.forceTrailReplace.clear();
    this.deathSlotsThisRound.clear();
    this.pendingEvents = [];

    this.startRound();

    // Start simulation loop
    this.setSimulationInterval((dt) => this.gameLoop(dt), SIM_INTERVAL_MS);
  }

  private startRound(): void {
    if (!this.simulation) return;
    this.simulation.startRound();
    this.state.phase = 'countdown';
    this.state.countdownTimer = COUNTDOWN_DURATION;
    this.state.roundNumber = this.simulation.round.roundNumber;
    this.state.tick = 0;
    this.deathSlotsThisRound.clear();
    this.forceTrailReplace.clear();
    this.pendingEvents.push({
      type: 'round-reset',
      tick: this.state.tick,
      roundNumber: this.state.roundNumber,
    });

    // Sync low-frequency spawn data for countdown rendering and reset all trails.
    this.syncBikesToSchema();
    for (let i = 0; i < this.simulation.bikes.length; i++) {
      this.lastTrailSentLength[i] = 0;
      this.trailRevisions[i] = (this.trailRevisions[i] ?? 0) + 1;
      this.forceTrailReplace.add(i);
    }
    this.syncScores();
  }

  private gameLoop(dt: number): void {
    if (!this.simulation) return;
    const dtSec = dt / 1000;

    switch (this.state.phase) {
      case 'countdown': {
        this.state.countdownTimer -= dtSec;
        if (this.state.countdownTimer <= -0.5) {
          this.state.phase = 'playing';
        }
        break;
      }

      case 'playing': {
        // Build input map (slot → PlayerInput)
        const inputs = new Map<number, PlayerInput>();
        for (const [sessionId, input] of this.playerInputs) {
          const slot = this.sessionToSlot.get(sessionId);
          if (slot != null) {
            inputs.set(slot, input);
          }
        }

        const result = this.simulation.tick(dtSec, inputs);
        this.state.tick++;

        const events = this.buildTickEvents(result);
        // Check round end
        if (result.roundEnded) {
          this.syncScores();
          events.push({ type: 'round-end', tick: this.state.tick, winnerIndex: result.winnerIndex });
          this.broadcastSnapshot(events);
          this.syncBikesToSchema();
          this.state.phase = 'roundEnd';

          const gameWinner = this.simulation.round.getWinner(this.state.roundsToWin);
          if (gameWinner >= 0) {
            this.clock.setTimeout(() => {
              this.state.phase = 'gameOver';
            }, 1500);
          } else {
            this.clock.setTimeout(() => {
              this.startRound();
            }, 3000);
          }
        } else {
          this.broadcastSnapshot(events);
        }
        break;
      }
    }
  }

  private sanitizeInput(data: InputFrame | PlayerInput): PlayerInput {
    if (typeof (data as InputFrame)?.buttons === 'number') {
      return unpackPlayerInput((data as InputFrame).buttons);
    }
    const input = data as PlayerInput;
    return {
      left: !!input.left,
      right: !!input.right,
      jump: !!input.jump,
      boost: !!input.boost,
      drift: !!input.drift,
      pitchUp: !!input.pitchUp,
      pitchDown: !!input.pitchDown,
    };
  }

  private buildTickEvents(result: ReturnType<Simulation['tick']>): GameEvent[] {
    if (!this.simulation) return [];
    const events: GameEvent[] = this.pendingEvents.splice(0);

    for (const bike of this.simulation.bikes) {
      if (!bike.alive && !this.deathSlotsThisRound.has(bike.playerIndex)) {
        this.deathSlotsThisRound.add(bike.playerIndex);
        events.push({
          type: 'bike-death',
          tick: this.state.tick,
          slot: bike.playerIndex,
          x: bike.position.x,
          y: bike.position.y,
          z: bike.position.z,
        });
      }
    }

    for (const event of result.powerUpEvents) {
      switch (event.type) {
        case 'powerup-spawn':
          if (event.powerupId != null && event.powerupX != null && event.powerupZ != null) {
            events.push({
              type: 'powerup-spawn',
              tick: this.state.tick,
              powerupId: event.powerupId,
              powerupX: event.powerupX,
              powerupZ: event.powerupZ,
              powerupType: event.powerupType ?? 'invulnerability',
            });
          }
          break;

        case 'powerup-pickup':
          if (event.powerupId != null && event.bikeIndex != null) {
            events.push({
              type: 'powerup-pickup',
              tick: this.state.tick,
              powerupId: event.powerupId,
              bikeIndex: event.bikeIndex,
              powerupType: event.powerupType ?? 'invulnerability',
            });
          }
          break;

        case 'trail-destroy':
          if (event.trailIndex != null && event.destroyX != null && event.destroyZ != null && event.destroyRadius != null) {
            this.trailRevisions[event.trailIndex] = (this.trailRevisions[event.trailIndex] ?? 0) + 1;
            this.forceTrailReplace.add(event.trailIndex);
            events.push({
              type: 'trail-destroy',
              tick: this.state.tick,
              trailIndex: event.trailIndex,
              destroyX: event.destroyX,
              destroyZ: event.destroyZ,
              destroyRadius: event.destroyRadius,
            });
          }
          break;
      }
    }

    return events;
  }

  private broadcastSnapshot(events: GameEvent[]): void {
    const snapshot = this.buildSnapshot(events);
    if (snapshot) {
      this.broadcast(ServerMsg.GameSnapshot, snapshot);
    }
  }

  private buildSnapshot(events: GameEvent[]): GameSnapshot | null {
    if (!this.simulation) return null;
    return {
      tick: this.state.tick,
      serverTime: this.clock.currentTime,
      phase: this.state.phase,
      roundNumber: this.state.roundNumber,
      roundsToWin: this.state.roundsToWin,
      bikes: this.simulation.bikes.map(bike => this.buildBikeSnapshot(bike)),
      trails: this.buildTrailUpdates(),
      powerUps: this.simulation.powerUps.powerUps.map(pu => ({
        id: pu.id,
        type: pu.type,
        x: pu.x,
        z: pu.z,
        active: pu.active,
      })),
      scores: [...this.simulation.round.scores],
      events,
    };
  }

  private buildBikeSnapshot(bike: Simulation['bikes'][number]): BikeSnapshot {
    return {
      slot: bike.playerIndex,
      x: bike.position.x,
      y: bike.position.y,
      z: bike.position.z,
      angle: bike.angle,
      vx: bike.vx,
      vy: bike.vy,
      vz: bike.vz,
      alive: bike.alive,
      grounded: bike.grounded,
      boostMeter: bike.boostMeter,
      boosting: bike.boosting,
      invulnerable: bike.invulnerable,
      invulnerableTimer: bike.invulnerableTimer,
      doubleJumpCooldown: bike.doubleJumpCooldown,
      drifting: bike.drifting,
      velocityAngle: bike.velocityAngle,
      pitch: bike.pitch,
      flying: bike.flying,
      surfaceType: bike.surfaceType,
      forwardX: bike.forward.x,
      forwardY: bike.forward.y,
      forwardZ: bike.forward.z,
    };
  }

  private buildTrailUpdates(): GameSnapshot['trails'] {
    if (!this.simulation) return [];
    const updates: GameSnapshot['trails'] = [];

    for (let i = 0; i < this.simulation.bikes.length; i++) {
      const bike = this.simulation.bikes[i]!;
      const points = bike.trail.points;
      const previousLength = this.lastTrailSentLength[i] ?? 0;
      const forceReplace = this.forceTrailReplace.has(i) || points.length < previousLength;

      if (forceReplace) {
        if (!this.forceTrailReplace.has(i)) {
          this.trailRevisions[i] = (this.trailRevisions[i] ?? 0) + 1;
        }
        updates.push({
          slot: bike.playerIndex,
          revision: this.trailRevisions[i] ?? 0,
          mode: 'replace',
          from: 0,
          points: points.map(toTrailPointWire),
        });
        this.lastTrailSentLength[i] = points.length;
        this.forceTrailReplace.delete(i);
      } else if (points.length > previousLength) {
        updates.push({
          slot: bike.playerIndex,
          revision: this.trailRevisions[i] ?? 0,
          mode: 'append',
          from: previousLength,
          points: points.slice(previousLength).map(toTrailPointWire),
        });
        this.lastTrailSentLength[i] = points.length;
      }
    }

    return updates;
  }

  private syncBikesToSchema(): void {
    if (!this.simulation) return;
    for (let i = 0; i < this.simulation.bikes.length && i < this.state.bikes.length; i++) {
      const sim = this.simulation.bikes[i];
      const bike = this.state.bikes[i]!;
      bike.x = sim.position.x;
      bike.y = sim.position.y;
      bike.z = sim.position.z;
      bike.angle = sim.angle;
      bike.alive = sim.alive;
    }
  }

  private syncScores(): void {
    if (!this.simulation) return;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      this.state.scores[i] = this.simulation.round.scores[i] ?? 0;
    }
  }
}
