import { SPAWN_POSITIONS } from '@tron/shared';
import type { SimBike } from './SimBike';

export class Round {
  roundNumber: number;
  scores: number[];

  constructor(playerCount: number) {
    this.roundNumber = 0;
    this.scores = new Array(playerCount).fill(0);
  }

  startRound(bikes: SimBike[]): void {
    this.roundNumber++;
    for (let i = 0; i < bikes.length; i++) {
      const spawn = SPAWN_POSITIONS[bikes[i].playerIndex] || SPAWN_POSITIONS[0];
      bikes[i].reset(spawn.x, spawn.z, spawn.angle);
    }
  }

  checkRoundEnd(bikes: SimBike[]): { ended: boolean; winnerIndex: number } {
    const alive = bikes.filter((b) => b.alive);

    if (alive.length <= 1) {
      let winnerIndex = -1;
      if (alive.length === 1) {
        winnerIndex = alive[0].playerIndex;
        this.scores[winnerIndex]++;
      }
      return { ended: true, winnerIndex };
    }

    return { ended: false, winnerIndex: -1 };
  }

  getWinner(roundsToWin: number): number {
    for (let i = 0; i < this.scores.length; i++) {
      if (this.scores[i] >= roundsToWin) return i;
    }
    return -1;
  }

  reset(): void {
    this.roundNumber = 0;
    this.scores.fill(0);
  }
}
