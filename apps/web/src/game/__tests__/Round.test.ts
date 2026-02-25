import { describe, it, expect } from 'vitest';
import { Round as SimRound } from '@tron/game-core';
import { MAX_PLAYERS } from '@tron/shared';

describe('Round (game-core)', () => {
  it('always allocates MAX_PLAYERS score slots', () => {
    const round = new SimRound();
    expect(round.scores).toHaveLength(MAX_PLAYERS);
    expect(round.scores.every(s => s === 0)).toBe(true);
  });

  it('scores indexed by playerIndex (slot) work for non-contiguous slots', () => {
    const round = new SimRound();

    // Simulate a game with slots 0 and 2 (skipping slot 1)
    round.scores[0] = 3;
    round.scores[2] = 5;

    expect(round.scores[0]).toBe(3);
    expect(round.scores[1]).toBe(0); // unused slot
    expect(round.scores[2]).toBe(5);
    expect(round.scores[3]).toBe(0); // unused slot
  });

  it('getWinner finds winner at any slot index', () => {
    const round = new SimRound();

    // Player at slot 2 wins
    round.scores[2] = 3;

    expect(round.getWinner(3)).toBe(2);
  });

  it('getWinner returns -1 when no winner', () => {
    const round = new SimRound();
    round.scores[0] = 2;
    round.scores[2] = 1;

    expect(round.getWinner(3)).toBe(-1);
  });

  it('reset zeroes all MAX_PLAYERS slots', () => {
    const round = new SimRound();
    round.scores[0] = 5;
    round.scores[3] = 3;
    round.roundNumber = 7;

    round.reset();

    expect(round.scores).toHaveLength(MAX_PLAYERS);
    expect(round.scores.every(s => s === 0)).toBe(true);
    expect(round.roundNumber).toBe(0);
  });

  it('checkRoundEnd increments score for surviving bike by slot', () => {
    const round = new SimRound();

    // Simulate bikes at slots 0 and 2
    const bikes = [
      { playerIndex: 0, alive: false },
      { playerIndex: 2, alive: true },
    ] as any;

    const result = round.checkRoundEnd(bikes);

    expect(result.ended).toBe(true);
    expect(result.winnerIndex).toBe(2);
    expect(round.scores[2]).toBe(1);
    // Slot 0 should still be 0
    expect(round.scores[0]).toBe(0);
  });
});
