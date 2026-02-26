/**
 * HighlightTracker: Timestamps game events relative to recording start
 * and assigns priority scores for ranking highlights.
 */

import { PLAYER_NAMES } from '@tron/shared';
import type { GameEvent } from '@tron/shared';
import type { PowerUpEvent } from '@tron/game-core';

export interface Highlight {
  type: string;
  label: string;
  timestamp: number; // seconds from recording start
  priority: number;
  event: GameEvent | PowerUpEvent;
}

export class HighlightTracker {
  private startTime = 0;
  private highlights: Highlight[] = [];

  start(): void {
    this.startTime = performance.now();
    this.highlights = [];
  }

  private getTimestamp(): number {
    return (performance.now() - this.startTime) / 1000;
  }

  addGameEvent(event: GameEvent): void {
    const timestamp = this.getTimestamp();
    let label: string;
    let priority: number;

    switch (event.type) {
      case 'gameWin':
        label = `${PLAYER_NAMES[event.winnerIndex] ?? 'Player'} wins the game!`;
        priority = 100;
        break;
      case 'roundWin':
        label = `${PLAYER_NAMES[event.winnerIndex] ?? 'Player'} wins round ${event.roundNumber}`;
        priority = 80;
        break;
      case 'death':
        if (event.cause === 'trail' && event.killerIndex >= 0) {
          label = `${PLAYER_NAMES[event.killerIndex] ?? 'Player'} eliminates ${PLAYER_NAMES[event.playerIndex] ?? 'Player'}`;
          priority = 60;
        } else if (event.cause === 'self') {
          label = `${PLAYER_NAMES[event.playerIndex] ?? 'Player'} self-destructs`;
          priority = 40;
        } else {
          label = `${PLAYER_NAMES[event.playerIndex] ?? 'Player'} hits the wall`;
          priority = 40;
        }
        break;
      case 'nearMiss': {
        const closenessBonus = Math.max(0, 10 * (1 - event.distance / 2.5));
        label = `${PLAYER_NAMES[event.playerIndex] ?? 'Player'} near miss with ${PLAYER_NAMES[event.trailOwnerIndex] ?? 'Player'}'s trail`;
        priority = 30 + closenessBonus;
        break;
      }
    }

    this.highlights.push({ type: event.type, label, timestamp, priority, event });
  }

  addPowerUpEvent(event: PowerUpEvent): void {
    if (event.type !== 'powerup-pickup') return;
    const timestamp = this.getTimestamp();
    const label = `${PLAYER_NAMES[event.bikeIndex ?? 0] ?? 'Player'} picks up power-up`;
    this.highlights.push({ type: 'powerup', label, timestamp, priority: 20, event });
  }

  getTopHighlights(count: number): Highlight[] {
    return [...this.highlights]
      .sort((a, b) => b.priority - a.priority)
      .slice(0, count);
  }

  getAllHighlights(): Highlight[] {
    return [...this.highlights].sort((a, b) => a.timestamp - b.timestamp);
  }
}
