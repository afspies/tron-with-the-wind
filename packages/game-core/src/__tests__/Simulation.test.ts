import { describe, it, expect } from 'vitest';
import { NO_INPUT } from '@tron/shared';
import type { PlayerInput } from '@tron/shared';
import { Simulation } from '../Simulation.js';
import type { SimulationConfig } from '../Simulation.js';
import { input } from './helpers.js';

function createConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    playerCount: 3,
    aiCount: 1,
    aiDifficulty: 'easy',
    roundsToWin: 3,
    humanSlots: [0, 1],
    ...overrides,
  };
}

describe('Simulation', () => {
  it('creates correct number of bikes (2 humans + 1 AI = 3)', () => {
    const sim = new Simulation(createConfig());
    expect(sim.bikes.length).toBe(3);
  });

  it('AI bikes have canWallDrive=false', () => {
    const sim = new Simulation(createConfig());
    const aiBike = sim.getBikeBySlot(2);
    expect(aiBike).toBeDefined();
    expect(aiBike!.canWallDrive).toBe(false);
  });

  it('human bikes have canWallDrive=true', () => {
    const sim = new Simulation(createConfig());
    const humanBike = sim.getBikeBySlot(0);
    expect(humanBike).toBeDefined();
    expect(humanBike!.canWallDrive).toBe(true);
  });

  it('getBikeBySlot returns correct bike', () => {
    const sim = new Simulation(createConfig());
    for (const bike of sim.bikes) {
      expect(sim.getBikeBySlot(bike.playerIndex)).toBe(bike);
    }
  });

  it('getBikeBySlot returns undefined for non-existent slot', () => {
    const sim = new Simulation(createConfig());
    expect(sim.getBikeBySlot(99)).toBeUndefined();
  });

  it('tick until roundEnded=true, verify ≤1 alive', () => {
    const sim = new Simulation(createConfig());
    sim.startRound();

    const inputs = new Map<number, PlayerInput>();
    inputs.set(0, input({ left: true }));
    inputs.set(1, input({ right: true }));

    let roundEnded = false;
    for (let i = 0; i < 3000; i++) {
      const result = sim.tick(1 / 60, inputs);
      if (result.roundEnded) {
        roundEnded = true;
        break;
      }
    }

    expect(roundEnded).toBe(true);
    const aliveCount = sim.bikes.filter(b => b.alive).length;
    expect(aliveCount).toBeLessThanOrEqual(1);
  });
});
