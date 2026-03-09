import { describe, it, expect } from 'vitest';
import { ARENA_HALF, WALL_MIN_SPEED } from '@tron/shared';
import { createBike, input, tickN, dot } from './helpers.js';

describe('SimBike surface physics', () => {
  describe('floor steering', () => {
    it('turn left increases angle, forward.y stays 0, position.y stays 0', () => {
      const bike = createBike({ angle: 0 });
      const startAngle = bike.angle;
      tickN(bike, 30, input({ left: true }));

      expect(bike.angle).toBeGreaterThan(startAngle);
      expect(bike.forward.y).toBeCloseTo(0, 3);
      expect(bike.position.y).toBeCloseTo(0, 1);
    });

    it('turn right decreases angle', () => {
      const bike = createBike({ angle: 0 });
      const startAngle = bike.angle;
      tickN(bike, 30, input({ right: true }));

      expect(bike.angle).toBeLessThan(startAngle);
    });
  });

  describe('wall steering', () => {
    it('rotates forward around surfaceNormal, not just in XZ plane', () => {
      const bike = createBike({ x: ARENA_HALF - 1, z: 0, angle: 0 });
      bike.position.y = 30;
      bike.speed = 30;
      bike.forward = { x: 0, y: 0, z: 1 };

      tickN(bike, 30, input({ left: true }));

      expect(Math.abs(bike.forward.y)).toBeGreaterThan(0.1);
    });

    it('forward stays in surface plane after ticks on ramp', () => {
      const bike = createBike({ x: ARENA_HALF - 4, z: 0, angle: Math.PI });
      bike.position.y = 2;
      bike.speed = 30;

      tickN(bike, 10, input({ left: true }));

      expect(bike.onSurface).toBe(true);
      expect(Math.abs(dot(bike.forward, bike.surfaceNormal))).toBeLessThan(0.15);
    });
  });

  describe('angle derived from forward', () => {
    it('angle === atan2(forward.x, forward.z) after ticks', () => {
      const bike = createBike({ angle: Math.PI / 4 });
      tickN(bike, 20, input({ left: true }));

      const expected = Math.atan2(bike.forward.x, bike.forward.z);
      expect(bike.angle).toBeCloseTo(expected, 3);
    });
  });

  describe('wall detach at low speed', () => {
    it('speed < WALL_MIN_SPEED → detaches from surface', () => {
      const bike = createBike({ x: ARENA_HALF - 1, z: 0, angle: 0 });
      bike.position.y = 30;
      bike.speed = WALL_MIN_SPEED - 1;
      bike.forward = { x: 0, y: 0, z: 1 };

      tickN(bike, 5);

      expect(bike.onSurface).toBe(false);
    });
  });

  describe('drift resets on wall', () => {
    it('drifting becomes false on wall-like surface', () => {
      const bike = createBike({ x: ARENA_HALF - 1, z: 0, angle: 0 });
      bike.position.y = 30;
      bike.speed = 30;
      bike.drifting = true;
      bike.forward = { x: 0, y: 0, z: 1 };

      tickN(bike, 1, input({ drift: true }));

      expect(bike.drifting).toBe(false);
    });
  });

  describe('velocity matches heading when not drifting', () => {
    it('vx/vz direction ≈ forward direction on floor', () => {
      const bike = createBike({ angle: Math.PI / 3 });
      tickN(bike, 30);

      const vel = { x: bike.vx, y: 0, z: bike.vz };
      const fwd = { x: bike.forward.x, y: 0, z: bike.forward.z };
      const vLen = Math.sqrt(dot(vel, vel));
      const fLen = Math.sqrt(dot(fwd, fwd));
      expect(vLen).toBeGreaterThan(0.1);
      const cosAngle = dot(vel, fwd) / (vLen * fLen);
      expect(cosAngle).toBeGreaterThan(0.95);
    });
  });
});
