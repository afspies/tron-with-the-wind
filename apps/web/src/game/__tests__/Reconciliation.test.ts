import { describe, it, expect } from 'vitest';
import { SurfaceType, BOOST_MAX, wrapAngle } from '@tron/shared';
import { SimBike } from '@tron/game-core';

function createBike(x = 0, z = 0, angle = 0): SimBike {
  return new SimBike(0, '#fff', x, z, angle);
}

function serverState(overrides: Record<string, unknown> = {}) {
  return {
    x: 0, y: 0, z: 0, angle: 0,
    vx: 0, vz: 30, vy: 0,
    alive: true, grounded: true,
    boosting: false, boostMeter: BOOST_MAX,
    drifting: false, velocityAngle: 0,
    pitch: 0, flying: false,
    surfaceType: SurfaceType.Floor as number,
    forwardX: 0, forwardY: 0, forwardZ: 1,
    doubleJumpCooldown: 0,
    jumpCooldown: 0,
    boostRechargeTimer: 0,
    usedDoubleJumpThisAirborne: false,
    invulnerable: false, invulnerableTimer: 0,
    ...overrides,
  };
}

describe('Reconciliation', () => {
  describe('applyServerState', () => {
    it('unconditionally snaps all fields to server values', () => {
      const bike = createBike(0, 0, 0);
      const state = serverState({ x: 50, z: 20, angle: 1.5, vy: 3 });

      bike.applyServerState(state);

      expect(bike.position.x).toBe(state.x);
      expect(bike.position.z).toBe(state.z);
      expect(bike.angle).toBe(state.angle);
      expect(bike.vy).toBe(state.vy);
    });

    it('server says dead → bike dies regardless of local prediction', () => {
      const bike = createBike(10, 10, 0);
      expect(bike.alive).toBe(true);

      bike.applyServerState(serverState({ alive: false }));

      expect(bike.alive).toBe(false);
    });
  });

  describe('wrapAngle', () => {
    it('wraps +3π correctly', () => {
      expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 5);
    });

    it('wraps -3π correctly', () => {
      expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(-Math.PI, 5);
    });

    it('0 stays 0', () => {
      expect(wrapAngle(0)).toBe(0);
    });

    it('π stays π', () => {
      expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 5);
    });

    it('-π stays -π', () => {
      expect(wrapAngle(-Math.PI)).toBeCloseTo(-Math.PI, 5);
    });

    it('values in (-π, π) unchanged', () => {
      expect(wrapAngle(1.5)).toBeCloseTo(1.5, 5);
      expect(wrapAngle(-1.5)).toBeCloseTo(-1.5, 5);
    });
  });
});
