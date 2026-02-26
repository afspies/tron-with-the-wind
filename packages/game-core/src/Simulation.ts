import type { PlayerInput, AIDifficulty, GameEvent } from '@tron/shared';
import { NO_INPUT, PLAYER_COLORS } from '@tron/shared';
import { SimBike } from './SimBike';
import { SimTrail } from './SimTrail';
import { Round } from './Round';
import { PowerUpSim, type PowerUpEvent } from './PowerUpSim';
import { AIController } from './AI';
import { checkNearMiss } from './Collision';

const NEAR_MISS_THRESHOLD = 2.5;
const NEAR_MISS_DEBOUNCE = 1.5; // seconds

export interface TickResult {
  roundEnded: boolean;
  winnerIndex: number;
  powerUpEvents: PowerUpEvent[];
  gameEvents: GameEvent[];
}

export interface SimulationConfig {
  playerCount: number;
  aiCount: number;
  aiDifficulty: AIDifficulty;
  roundsToWin: number;
  /** Slot indices that are human players */
  humanSlots: number[];
}

export class Simulation {
  bikes: SimBike[] = [];
  trails: SimTrail[] = [];
  round: Round;
  powerUps: PowerUpSim;
  aiControllers: Map<number, AIController> = new Map();
  elapsedTime = 0;
  lastBroadcastTrailLen: number[] = [];
  private nearMissTimers: Map<number, number> = new Map();

  private config: SimulationConfig;

  constructor(config: SimulationConfig) {
    this.config = config;
    const totalPlayers = config.humanSlots.length + config.aiCount;

    // Determine which slots are used
    const usedSlots = [...config.humanSlots];
    for (let s = 0; s < 4 && usedSlots.length < totalPlayers; s++) {
      if (!usedSlots.includes(s)) usedSlots.push(s);
    }
    usedSlots.sort((a, b) => a - b);

    // Create bikes
    for (const slot of usedSlots) {
      const bike = new SimBike(slot, PLAYER_COLORS[slot] || '#888', 0, 0, 0);
      this.bikes.push(bike);
      this.trails.push(bike.trail);

      // AI for non-human slots
      if (!config.humanSlots.includes(slot)) {
        this.aiControllers.set(slot, new AIController(config.aiDifficulty));
      }
    }

    this.round = new Round();
    this.powerUps = new PowerUpSim();
    this.lastBroadcastTrailLen = new Array(this.bikes.length).fill(0);
  }

  startRound(): void {
    this.powerUps.reset();
    this.round.startRound(this.bikes);
    this.lastBroadcastTrailLen = new Array(this.bikes.length).fill(0);
  }

  tick(dt: number, inputs: Map<number, PlayerInput>): TickResult {
    this.elapsedTime += dt;
    const gameEvents: GameEvent[] = [];

    const activePUs = this.powerUps.powerUps
      .filter(p => p.active)
      .map(p => ({ x: p.x, z: p.z }));

    // Decrement near-miss debounce timers
    for (const [idx, timer] of this.nearMissTimers) {
      const remaining = timer - dt;
      if (remaining <= 0) this.nearMissTimers.delete(idx);
      else this.nearMissTimers.set(idx, remaining);
    }

    for (const bike of this.bikes) {
      if (!bike.alive) continue;

      let input: PlayerInput;
      if (this.aiControllers.has(bike.playerIndex)) {
        input = this.aiControllers.get(bike.playerIndex)!.getInput(
          bike, this.trails, this.elapsedTime, activePUs,
        );
      } else {
        input = inputs.get(bike.playerIndex) || NO_INPUT;
      }

      const deathInfo = bike.update(dt, input, this.trails);

      if (deathInfo) {
        const killerIndex = deathInfo.cause === 'trail' ? this.bikes[deathInfo.trailIndex]?.playerIndex ?? -1 : -1;
        gameEvents.push({
          type: 'death',
          playerIndex: bike.playerIndex,
          killerIndex,
          cause: deathInfo.cause,
          x: deathInfo.contactX,
          z: deathInfo.contactZ,
        });
      } else if (bike.grounded && !this.nearMissTimers.has(bike.playerIndex)) {
        // Near-miss detection for alive, grounded bikes
        const nearMiss = checkNearMiss(
          bike.position.x, bike.position.z, bike.position.y,
          this.trails, bike.playerIndex, NEAR_MISS_THRESHOLD,
        );
        if (nearMiss) {
          this.nearMissTimers.set(bike.playerIndex, NEAR_MISS_DEBOUNCE);
          gameEvents.push({
            type: 'nearMiss',
            playerIndex: bike.playerIndex,
            trailOwnerIndex: nearMiss.trailIndex,
            distance: nearMiss.distance,
            x: nearMiss.x,
            z: nearMiss.z,
          });
        }
      }
    }

    const powerUpEvents = this.powerUps.update(dt, this.bikes, this.trails, this.lastBroadcastTrailLen);

    const { ended, winnerIndex } = this.round.checkRoundEnd(this.bikes);

    if (ended) {
      gameEvents.push({
        type: 'roundWin',
        winnerIndex,
        roundNumber: this.round.roundNumber,
      });
      const gameWinner = this.round.getWinner(this.config.roundsToWin);
      if (gameWinner >= 0) {
        gameEvents.push({ type: 'gameWin', winnerIndex: gameWinner });
      }
    }

    return { roundEnded: ended, winnerIndex, powerUpEvents, gameEvents };
  }

  getBikeBySlot(slot: number): SimBike | undefined {
    return this.bikes.find(b => b.playerIndex === slot);
  }
}
