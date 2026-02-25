import { SPAWN_POSITIONS, MAX_PLAYERS } from '@tron/shared';
import { Bike } from './Bike';

export class Round {
  roundNumber: number;
  scores: number[];

  constructor() {
    this.roundNumber = 0;
    this.scores = new Array(MAX_PLAYERS).fill(0);
  }

  startRound(bikes: Bike[]): void {
    this.roundNumber++;
    for (let i = 0; i < bikes.length; i++) {
      const spawn = SPAWN_POSITIONS[i];
      bikes[i].reset(spawn.x, spawn.z, spawn.angle);
    }
  }

  checkRoundEnd(bikes: Bike[]): { ended: boolean; winnerIndex: number } {
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
