import { Room, Client } from 'colyseus';
import { Simulation } from '@tron/game-core';
import { COUNTDOWN_DURATION, PLAYER_NAMES, MAX_PLAYERS, ClientMsg, ServerMsg } from '@tron/shared';
import type { PlayerInput, AIDifficulty } from '@tron/shared';
import {
  TronState, PlayerSchema, BikeSchema, TrailPointSchema, PowerUpSchema,
} from './schema/TronState';

const SIM_INTERVAL_MS = 33;   // 30 Hz physics

export class TronRoom extends Room<TronState> {
  maxClients = MAX_PLAYERS;
  patchRate = 33;              // 30 Hz state patches — match physics tick rate

  private simulation: Simulation | null = null;
  private playerInputs = new Map<string, PlayerInput>();
  private playerInputTicks = new Map<string, number>();
  private sessionToSlot = new Map<string, number>();

  onCreate(_options: { roomCode?: string }): void {
    this.setState(new TronState());
    this.autoDispose = true;

    this.onMessage(ClientMsg.Input, (client, data: PlayerInput & { tick?: number }) => {
      if (this.state.phase !== 'playing') return;
      this.playerInputs.set(client.sessionId, {
        left: !!data.left,
        right: !!data.right,
        jump: !!data.jump,
        boost: !!data.boost,
        drift: !!data.drift,
        pitchUp: !!data.pitchUp,
        pitchDown: !!data.pitchDown,
      });
      if (data.tick != null) {
        this.playerInputTicks.set(client.sessionId, data.tick);
      }
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
    this.playerInputTicks.delete(client.sessionId);

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
    this.playerInputTicks.clear();

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

    // Sync initial bike positions + trail reset
    this.syncBikesToSchema();
    for (const bikeSchema of this.state.bikes) {
      bikeSchema.trail.clear();
    }
    this.syncPowerUpsToSchema();
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

        // Sync simulation state to schema
        this.syncBikesToSchema();
        this.syncTrailsToSchema();

        // Handle powerup events
        for (const event of result.powerUpEvents) {
          if (event.type === 'powerup-spawn' || event.type === 'powerup-pickup') {
            this.broadcast(ServerMsg.PowerUpEffect, event);
          }
        }
        this.syncPowerUpsToSchema();

        // Check round end
        if (result.roundEnded) {
          this.syncScores();
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
        }
        break;
      }
    }
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
      bike.vy = sim.vy;
      bike.alive = sim.alive;
      bike.grounded = sim.grounded;
      bike.boostMeter = sim.boostMeter;
      bike.boosting = sim.boosting;
      bike.invulnerable = sim.invulnerable;
      bike.invulnerableTimer = sim.invulnerableTimer;
      bike.doubleJumpCooldown = sim.doubleJumpCooldown;
      bike.drifting = sim.drifting;
      bike.velocityAngle = sim.velocityAngle;
      bike.pitch = sim.pitch;
      bike.flying = sim.flying;
      bike.surfaceType = sim.surfaceType;
      bike.forwardX = sim.forward.x;
      bike.forwardY = sim.forward.y;
      bike.forwardZ = sim.forward.z;
      bike.vx = sim.vx;
      bike.vz = sim.vz;

      // Sync last processed input tick for client reconciliation
      for (const [sessionId, slot] of this.sessionToSlot) {
        if (slot === sim.playerIndex) {
          bike.lastInputTick = this.playerInputTicks.get(sessionId) ?? 0;
          break;
        }
      }
    }
  }

  private syncTrailsToSchema(): void {
    if (!this.simulation) return;
    for (let i = 0; i < this.simulation.bikes.length && i < this.state.bikes.length; i++) {
      const simTrail = this.simulation.bikes[i].trail;
      const bikeSchema = this.state.bikes[i]!;
      const schemaTrail = bikeSchema.trail;
      const simPoints = simTrail.points;

      // Colyseus delta-encodes ArraySchema — appending new items sends only the new ones
      if (simPoints.length > schemaTrail.length) {
        // Append new points
        for (let j = schemaTrail.length; j < simPoints.length; j++) {
          const tp = new TrailPointSchema();
          tp.x = simPoints[j].x;
          tp.y = simPoints[j].y;
          tp.z = simPoints[j].z;
          schemaTrail.push(tp);
        }
      } else if (simPoints.length < schemaTrail.length) {
        // Trail shrank (deletion) — full rebuild
        schemaTrail.clear();
        for (const p of simPoints) {
          const tp = new TrailPointSchema();
          tp.x = p.x;
          tp.y = p.y;
          tp.z = p.z;
          schemaTrail.push(tp);
        }
      }
    }
  }

  private syncPowerUpsToSchema(): void {
    if (!this.simulation) return;
    const simPUs = this.simulation.powerUps.powerUps;

    // Add new power-ups
    while (this.state.powerUps.length < simPUs.length) {
      this.state.powerUps.push(new PowerUpSchema());
    }

    // Shrink schema array to match sim (inactive powerups are pruned)
    while (this.state.powerUps.length > simPUs.length) {
      this.state.powerUps.pop();
    }

    for (let i = 0; i < simPUs.length; i++) {
      const sim = simPUs[i];
      const pu = this.state.powerUps[i]!;
      pu.id = sim.id;
      pu.puType = sim.type;
      pu.x = sim.x;
      pu.z = sim.z;
      pu.active = sim.active;
    }
  }

  private syncScores(): void {
    if (!this.simulation) return;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      this.state.scores[i] = this.simulation.round.scores[i] ?? 0;
    }
  }
}
