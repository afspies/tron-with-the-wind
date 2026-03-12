import { describe, it, expect } from 'vitest';
import { SurfaceType, BOOST_MAX, BOOST_RECHARGE_DELAY, ARENA_HALF } from '@tron/shared';
import { getArenaSurfaceInfo } from '../ArenaSurface.js';
import { createBike, input, tickN, snapshot } from './helpers.js';

describe('SimBike state', () => {
  describe('applyServerState round-trip', () => {
    it('tick 100 frames, snapshot, apply to fresh bike → all fields match', () => {
      const bike = createBike({ x: 10, z: 10, angle: Math.PI / 4 });
      tickN(bike, 100, input({ left: true }));

      const fresh = createBike();
      fresh.applyServerState(snapshot(bike));

      // Continuous fields
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(fresh.position[axis]).toBeCloseTo(bike.position[axis], 5);
        expect(fresh.forward[axis]).toBeCloseTo(bike.forward[axis], 5);
      }
      expect(fresh.angle).toBeCloseTo(bike.angle, 5);
      expect(fresh.vx).toBeCloseTo(bike.vx, 5);
      expect(fresh.vz).toBeCloseTo(bike.vz, 5);
      expect(fresh.vy).toBeCloseTo(bike.vy, 5);
      expect(fresh.boostMeter).toBeCloseTo(bike.boostMeter, 5);
      expect(fresh.pitch).toBeCloseTo(bike.pitch, 5);

      // Discrete fields
      expect(fresh.alive).toBe(bike.alive);
      expect(fresh.grounded).toBe(bike.grounded);
      expect(fresh.boosting).toBe(bike.boosting);
      expect(fresh.drifting).toBe(bike.drifting);
      expect(fresh.flying).toBe(bike.flying);
      expect(fresh.surfaceType).toBe(bike.surfaceType);
    });

    it('derives surfaceNormal from position when applying wall state', () => {
      const fresh = createBike();
      fresh.applyServerState({
        x: ARENA_HALF - 1, y: 30, z: 0, angle: 0,
        vx: 0, vz: 30, vy: 0,
        alive: true, grounded: false,
        boosting: false, boostMeter: BOOST_MAX,
        drifting: false, velocityAngle: 0,
        pitch: 0, flying: false,
        surfaceType: SurfaceType.WallXPos,
        forwardX: 0, forwardY: 0, forwardZ: 1,
        doubleJumpCooldown: 0,
        jumpCooldown: 0,
        boostRechargeTimer: 0,
        usedDoubleJumpThisAirborne: false,
        invulnerable: false, invulnerableTimer: 0,
      });

      const expectedNormal = getArenaSurfaceInfo(fresh.position).normal;
      expect(fresh.surfaceNormal.x).toBeCloseTo(expectedNormal.x, 3);
      expect(fresh.surfaceNormal.y).toBeCloseTo(expectedNormal.y, 3);
      expect(fresh.onSurface).toBe(true);
    });

    it('surfaceType=Air → onSurface=false', () => {
      const fresh = createBike();
      fresh.applyServerState({
        x: 0, y: 10, z: 0, angle: 0,
        vx: 0, vz: 30, vy: 5,
        alive: true, grounded: false,
        boosting: false, boostMeter: BOOST_MAX,
        drifting: false, velocityAngle: 0,
        pitch: 0, flying: false,
        surfaceType: SurfaceType.Air,
        forwardX: 0, forwardY: 0, forwardZ: 1,
        doubleJumpCooldown: 0,
        jumpCooldown: 0,
        boostRechargeTimer: 0,
        usedDoubleJumpThisAirborne: false,
        invulnerable: false, invulnerableTimer: 0,
      });

      expect(fresh.onSurface).toBe(false);
    });
  });

  describe('reset', () => {
    it('clears all state back to defaults', () => {
      const bike = createBike({ x: 10, z: 10, angle: 1 });
      bike.alive = false;
      bike.boosting = true;
      bike.boostMeter = 0;
      bike.drifting = true;
      bike.flying = true;
      bike.pitch = 1;
      bike.vy = 50;
      bike.doubleJumpCooldown = 10;
      bike.position.y = 30;

      bike.reset(5, 5, Math.PI / 2);

      expect(bike.alive).toBe(true);
      expect(bike.grounded).toBe(true);
      expect(bike.position.x).toBe(5);
      expect(bike.position.y).toBe(0);
      expect(bike.position.z).toBe(5);
      expect(bike.angle).toBe(Math.PI / 2);
      expect(bike.vy).toBe(0);
      expect(bike.boosting).toBe(false);
      expect(bike.boostMeter).toBe(BOOST_MAX);
      expect(bike.drifting).toBe(false);
      expect(bike.flying).toBe(false);
      expect(bike.pitch).toBe(0);
      expect(bike.doubleJumpCooldown).toBe(0);
      expect(bike.doubleJumpReady).toBe(true);
      expect(bike.onSurface).toBe(true);
      expect(bike.surfaceType).toBe(SurfaceType.Floor);
    });
  });

  describe('boost drain and recharge', () => {
    it('drains while boosting, recharges after delay', () => {
      const bike = createBike();
      const initialBoost = bike.boostMeter;

      tickN(bike, 60, input({ boost: true }));
      expect(bike.boostMeter).toBeLessThan(initialBoost);

      const afterDrain = bike.boostMeter;
      const rechargeTicks = Math.ceil(BOOST_RECHARGE_DELAY * 60) + 10;
      tickN(bike, rechargeTicks);

      expect(bike.boostMeter).toBeGreaterThan(afterDrain);
    });
  });
});
