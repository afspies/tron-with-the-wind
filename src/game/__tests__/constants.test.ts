import { describe, it, expect } from 'vitest';
import {
  ARENA_SIZE, ARENA_HALF, BIKE_SPEED, TRAIL_HEIGHT,
  JUMP_INITIAL_VY, GRAVITY, JUMP_PEAK_HEIGHT,
  PLAYER_COLORS, PLAYER_NAMES, SPAWN_POSITIONS,
} from '../constants';

describe('constants', () => {
  it('ARENA_HALF is half of ARENA_SIZE', () => {
    expect(ARENA_HALF).toBe(ARENA_SIZE / 2);
  });

  it('JUMP_INITIAL_VY matches peak height formula', () => {
    const expected = Math.sqrt(2 * GRAVITY * JUMP_PEAK_HEIGHT);
    expect(JUMP_INITIAL_VY).toBeCloseTo(expected);
  });

  it('has 4 player colors and names', () => {
    expect(PLAYER_COLORS).toHaveLength(4);
    expect(PLAYER_NAMES).toHaveLength(4);
  });

  it('has 4 spawn positions', () => {
    expect(SPAWN_POSITIONS).toHaveLength(4);
    for (const sp of SPAWN_POSITIONS) {
      expect(sp).toHaveProperty('x');
      expect(sp).toHaveProperty('z');
      expect(sp).toHaveProperty('angle');
    }
  });

  it('BIKE_SPEED and TRAIL_HEIGHT are positive', () => {
    expect(BIKE_SPEED).toBeGreaterThan(0);
    expect(TRAIL_HEIGHT).toBeGreaterThan(0);
  });
});
