import { describe, it, expect } from 'vitest';
import { SurfaceType, JUMP_INITIAL_VY, GRAVITY, FLIGHT_LANDING_MAX_PITCH, CEILING_HEIGHT } from '@tron/shared';
import { createBike, input, tickN, tickUntil } from './helpers.js';

describe('SimBike air physics', () => {
  describe('jump', () => {
    it('transitions to air: onSurface=false, vy>0, surfaceType=Air', () => {
      const bike = createBike();
      tickN(bike, 1, input({ jump: true }));

      expect(bike.onSurface).toBe(false);
      expect(bike.vy).toBeGreaterThan(0);
      expect(bike.surfaceType).toBe(SurfaceType.Air);
    });
  });

  describe('gravity', () => {
    it('position.y returns to 0 after jump arc', () => {
      const bike = createBike();
      tickN(bike, 1, input({ jump: true }));
      tickUntil(bike, (b) => b.grounded && b.position.y <= 0.01);

      expect(bike.position.y).toBeCloseTo(0, 0);
      expect(bike.grounded).toBe(true);
    });
  });

  describe('double jump', () => {
    it('second jump resets vy, doubleJumpReady becomes false', () => {
      const bike = createBike();
      tickN(bike, 1, input({ jump: true }));
      // Wait for jump cooldown to expire (~18 ticks at 1/60)
      tickN(bike, 25);
      const vyBefore = bike.vy;

      tickN(bike, 1, input({ jump: true }));

      expect(bike.doubleJumpReady).toBe(false);
      // vy is set to JUMP_INITIAL_VY then gravity is applied within the same tick
      const dt = 1 / 60;
      expect(bike.vy).toBeCloseTo(JUMP_INITIAL_VY - GRAVITY * dt, 3);
    });

    it('cooldown persists through landing', () => {
      const bike = createBike();
      tickN(bike, 1, input({ jump: true }));
      tickN(bike, 25);
      tickN(bike, 1, input({ jump: true }));

      expect(bike.doubleJumpReady).toBe(false);
      expect(bike.doubleJumpCooldown).toBeGreaterThan(0);

      tickUntil(bike, (b) => b.grounded);

      expect(bike.doubleJumpCooldown).toBeGreaterThan(0);
      expect(bike.doubleJumpReady).toBe(false);
    });
  });

  describe('flight', () => {
    it('jump + boost → flying=true, position.y increases', () => {
      const bike = createBike();
      tickN(bike, 1, input({ jump: true }));
      const yAfterJump = bike.position.y;

      tickN(bike, 10, input({ boost: true, pitchUp: true }));

      expect(bike.flying).toBe(true);
      expect(bike.position.y).toBeGreaterThan(yAfterJump);
    });
  });

  describe('ceiling bounce', () => {
    it('position stays at or below ceiling height', () => {
      const bike = createBike();
      tickN(bike, 1, input({ jump: true }));
      bike.vy = 100;
      bike.position.y = CEILING_HEIGHT - 1;

      tickN(bike, 5);

      expect(bike.position.y).toBeLessThanOrEqual(CEILING_HEIGHT);
    });
  });

  describe('steep landing kills', () => {
    it('landing with pitch > FLIGHT_LANDING_MAX_PITCH kills bike', () => {
      const bike = createBike();
      tickN(bike, 1, input({ jump: true }));
      bike.flying = true;
      bike.pitch = FLIGHT_LANDING_MAX_PITCH + 0.1;
      bike.position.y = 0.5;
      bike.vy = -5;

      tickUntil(bike, (b) => !b.alive || b.grounded, 30);

      expect(bike.alive).toBe(false);
    });
  });
});
