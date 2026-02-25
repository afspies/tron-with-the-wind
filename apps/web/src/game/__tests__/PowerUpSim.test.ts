import { describe, it, expect } from 'vitest';
import { PowerUpSim, SimBike, SimTrail } from '@tron/game-core';
import { POWERUP_SPAWN_DELAY, POWERUP_SPAWN_INTERVAL } from '@tron/shared';

describe('PowerUpSim', () => {
  describe('inactive powerup pruning', () => {
    it('removes inactive powerups after update', () => {
      const sim = new PowerUpSim();
      sim.reset();

      // Advance past spawn delay + interval to spawn a powerup
      const bikes: SimBike[] = [];
      const trails: SimTrail[] = [];
      const broadcastLen: number[] = [];

      sim.update(POWERUP_SPAWN_DELAY + POWERUP_SPAWN_INTERVAL + 0.1, bikes, trails, broadcastLen);
      expect(sim.powerUps.length).toBeGreaterThanOrEqual(1);
      expect(sim.powerUps[0].active).toBe(true);

      // Deactivate the powerup (simulating pickup)
      sim.powerUps[0].active = false;

      // Next update should prune it
      sim.update(0.016, bikes, trails, broadcastLen);
      expect(sim.powerUps).toHaveLength(0);
    });

    it('keeps active powerups after update', () => {
      const sim = new PowerUpSim();
      sim.reset();

      const bikes: SimBike[] = [];
      const trails: SimTrail[] = [];
      const broadcastLen: number[] = [];

      sim.update(POWERUP_SPAWN_DELAY + POWERUP_SPAWN_INTERVAL + 0.1, bikes, trails, broadcastLen);
      const count = sim.powerUps.length;
      expect(count).toBeGreaterThanOrEqual(1);

      // Update without deactivating
      sim.update(0.016, bikes, trails, broadcastLen);
      expect(sim.powerUps.length).toBe(count);
    });

    it('reset clears all powerups', () => {
      const sim = new PowerUpSim();
      sim.reset();

      const bikes: SimBike[] = [];
      const trails: SimTrail[] = [];
      const broadcastLen: number[] = [];

      sim.update(POWERUP_SPAWN_DELAY + POWERUP_SPAWN_INTERVAL + 0.1, bikes, trails, broadcastLen);
      expect(sim.powerUps.length).toBeGreaterThanOrEqual(1);

      sim.reset();
      expect(sim.powerUps).toHaveLength(0);
    });
  });

  describe('forceFullTrailResync removed', () => {
    it('does not have forceFullTrailResync property', () => {
      const sim = new PowerUpSim();
      expect('forceFullTrailResync' in sim).toBe(false);
    });
  });
});
