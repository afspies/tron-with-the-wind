import { describe, it, expect } from 'vitest';
import { NO_INPUT } from '@tron/shared';
import type { PlayerInput } from '@tron/shared';
import { runLockstepScenario } from './reconciliation-harness';

const straight: PlayerInput = { ...NO_INPUT };
const turnLeft: PlayerInput = { ...NO_INPUT, left: true };
const jumpInput: PlayerInput = { ...NO_INPUT, jump: true };
const boostInput: PlayerInput = { ...NO_INPUT, boost: true };

describe('ClientPrediction lockstep', () => {
  describe('determinism (zero latency)', () => {
    it('straight line → error exactly 0', () => {
      const result = runLockstepScenario({
        totalTicks: 300,
        latencyTicks: 0,
        inputSequence: () => straight,
      });
      expect(result.maxPosError).toBe(0);
    });

    it('turning → error exactly 0', () => {
      const result = runLockstepScenario({
        totalTicks: 300,
        latencyTicks: 0,
        inputSequence: () => turnLeft,
      });
      expect(result.maxPosError).toBe(0);
    });
  });

  // Flat-only tests: 80 ticks keeps the bike well within the arena floor (z≈80, wall at 100).
  // On flat ground, replay is bit-exact so error should be 0 regardless of latency.
  describe('flat ground (no ramp/wall)', () => {
    it('straight, 1-tick latency → zero error on flat', () => {
      const result = runLockstepScenario({
        totalTicks: 80,
        latencyTicks: 1,
        inputSequence: () => straight,
      });
      expect(result.maxPosError).toBe(0);
    });

    it('straight, 3-tick latency → zero error on flat', () => {
      const result = runLockstepScenario({
        totalTicks: 80,
        latencyTicks: 3,
        inputSequence: () => straight,
      });
      expect(result.maxPosError).toBe(0);
    });

    it('turning, 2-tick latency → zero error on flat', () => {
      const result = runLockstepScenario({
        totalTicks: 80,
        latencyTicks: 2,
        inputSequence: () => turnLeft,
      });
      expect(result.maxPosError).toBeLessThan(0.001);
    });
  });

  // Ramp/wall tests: 300 ticks drives the bike into the wall ramp zone.
  // Surface-dependent constraint in getArenaSurfaceInfo causes replay divergence.
  describe('ramp/wall transitions (300 ticks)', () => {
    it('straight, 1-tick latency → error from wall driving', () => {
      const result = runLockstepScenario({
        totalTicks: 300,
        latencyTicks: 1,
        inputSequence: () => straight,
      });
      // Error appears around tick 158 when bike drives up wall (y≈59, z≈96)
      console.log(`wall straight 1-tick: max=${result.maxPosError.toFixed(4)}`);
      expect(result.maxPosError).toBeLessThan(0.5);
    });

    it('straight, 3-tick latency → slightly larger wall error', () => {
      const result = runLockstepScenario({
        totalTicks: 300,
        latencyTicks: 3,
        inputSequence: () => straight,
      });
      console.log(`wall straight 3-tick: max=${result.maxPosError.toFixed(4)}`);
      expect(result.maxPosError).toBeLessThan(1.0);
    });
  });

  describe('state transitions', () => {
    it('jump on tick 10, 2-tick latency → error bounded', () => {
      const result = runLockstepScenario({
        totalTicks: 80,
        latencyTicks: 2,
        inputSequence: (tick) => (tick === 10 ? jumpInput : straight),
      });
      expect(result.maxPosError).toBeLessThan(0.001);
    });

    it('boost toggle, 2-tick latency → error bounded', () => {
      const result = runLockstepScenario({
        totalTicks: 80,
        latencyTicks: 2,
        inputSequence: (tick) => (tick >= 10 && tick <= 60 ? boostInput : straight),
      });
      expect(result.maxPosError).toBeLessThan(0.001);
    });
  });

  describe('float32 precision', () => {
    it('straight line with float32 → measure drift magnitude', () => {
      const result = runLockstepScenario({
        totalTicks: 300,
        latencyTicks: 2,
        inputSequence: () => straight,
        float32: true,
      });
      console.log(`float32 straight: max=${result.maxPosError.toFixed(6)}, avg=${result.avgPosError.toFixed(6)}`);
      expect(result.maxPosError).toBeLessThan(1.0);
    });

    it('turning with float32 → drift is bounded', () => {
      const result = runLockstepScenario({
        totalTicks: 300,
        latencyTicks: 2,
        inputSequence: () => turnLeft,
        float32: true,
      });
      console.log(`float32 turning: max=${result.maxPosError.toFixed(6)}, avg=${result.avgPosError.toFixed(6)}`);
      expect(result.maxPosError).toBeLessThan(1.0);
    });
  });

  // Simulates production: client runs at 60fps, accumulator produces 0 or 1 fixed steps
  // per frame instead of perfectly 1 step per tick (the ideal harness assumption).
  describe('realistic frame timing (60fps client)', () => {
    it('straight, 60fps, 2-tick latency → error within tuned threshold', () => {
      const result = runLockstepScenario({
        totalTicks: 80,
        latencyTicks: 2,
        inputSequence: () => straight,
        clientFps: 60,
      });
      console.log(`60fps straight: max=${result.maxPosError.toFixed(6)}, avg=${result.avgPosError.toFixed(6)}`);
      // Accumulator drift causes small errors; tuned RENDER_OFFSET_MIN_CORRECTION (0.25) suppresses these
      expect(result.maxPosError).toBeLessThan(1.0);
    });

    it('turning, 60fps, 2-tick latency → error within tuned threshold', () => {
      const result = runLockstepScenario({
        totalTicks: 80,
        latencyTicks: 2,
        inputSequence: () => turnLeft,
        clientFps: 60,
      });
      console.log(`60fps turning: max=${result.maxPosError.toFixed(6)}, avg=${result.avgPosError.toFixed(6)}`);
      expect(result.maxPosError).toBeLessThan(1.0);
    });

    it('60fps + float32 (realistic production conditions)', () => {
      const result = runLockstepScenario({
        totalTicks: 80,
        latencyTicks: 2,
        inputSequence: () => straight,
        clientFps: 60,
        float32: true,
      });
      console.log(`60fps+f32 straight: max=${result.maxPosError.toFixed(6)}, avg=${result.avgPosError.toFixed(6)}`);
      expect(result.maxPosError).toBeLessThan(1.0);
    });

    it('60fps + float32 + server jitter (worst realistic case)', () => {
      const result = runLockstepScenario({
        totalTicks: 80,
        latencyTicks: 2,
        inputSequence: () => straight,
        clientFps: 60,
        float32: true,
        serverDtJitter: 0.10,
      });
      console.log(`60fps+f32+jitter: max=${result.maxPosError.toFixed(6)}, avg=${result.avgPosError.toFixed(6)}`);
      expect(result.maxPosError).toBeLessThan(5.0);
    });
  });

  // Simulates real-world conditions: server under load sends ticks at varying intervals.
  // Even with 2 players, GC pauses or event loop contention cause dt variance.
  describe('server timing jitter', () => {
    it('straight line, ±10% dt jitter, 2-tick latency → measures jitter-induced drift', () => {
      const result = runLockstepScenario({
        totalTicks: 80,
        latencyTicks: 2,
        inputSequence: () => straight,
        serverDtJitter: 0.10,
      });
      console.log(`jitter ±10% straight: max=${result.maxPosError.toFixed(6)}, avg=${result.avgPosError.toFixed(6)}`);
      // Server runs with variable dt but client replays with fixed dt — drift is expected
      expect(result.maxPosError).toBeGreaterThan(0); // proves jitter causes drift
      expect(result.maxPosError).toBeLessThan(5.0);
    });

    it('straight line, ±25% dt jitter (heavy load), 2-tick latency', () => {
      const result = runLockstepScenario({
        totalTicks: 80,
        latencyTicks: 2,
        inputSequence: () => straight,
        serverDtJitter: 0.25,
      });
      console.log(`jitter ±25% straight: max=${result.maxPosError.toFixed(6)}, avg=${result.avgPosError.toFixed(6)}`);
      expect(result.maxPosError).toBeLessThan(10.0);
    });

    it('turning, ±10% dt jitter, 2-tick latency', () => {
      const result = runLockstepScenario({
        totalTicks: 80,
        latencyTicks: 2,
        inputSequence: () => turnLeft,
        serverDtJitter: 0.10,
      });
      console.log(`jitter ±10% turning: max=${result.maxPosError.toFixed(6)}, avg=${result.avgPosError.toFixed(6)}`);
      expect(result.maxPosError).toBeLessThan(5.0);
    });

    it('straight line, ±10% jitter + float32 (realistic worst case)', () => {
      const result = runLockstepScenario({
        totalTicks: 80,
        latencyTicks: 2,
        inputSequence: () => straight,
        serverDtJitter: 0.10,
        float32: true,
      });
      console.log(`jitter+f32 straight: max=${result.maxPosError.toFixed(6)}, avg=${result.avgPosError.toFixed(6)}`);
      expect(result.maxPosError).toBeLessThan(5.0);
    });
  });
});
