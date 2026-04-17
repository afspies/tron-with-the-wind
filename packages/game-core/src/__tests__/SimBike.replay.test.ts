import { describe, it, expect } from 'vitest';
import type { PlayerInput } from '@tron/shared';
import { NO_INPUT } from '@tron/shared';
import { createBike } from './helpers.js';

/**
 * Determinism canary for Valve-style client prediction: snapshot the bike,
 * run a sequence of inputs, record the final state. Restore the snapshot,
 * run the same inputs, assert the final state matches bit-identically.
 *
 * If this test ever fails, input-replay reconciliation will produce visible
 * drift on the client and Valve-style netcode is unsafe on this simulation.
 */

const FIXED_DT = 1 / 30;

function makeInputs(count: number, seed: number): PlayerInput[] {
  // Deterministic pseudo-random input stream (Mulberry32).
  let s = seed >>> 0;
  const rand = (): number => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const inputs: PlayerInput[] = [];
  for (let i = 0; i < count; i++) {
    inputs.push({
      ...NO_INPUT,
      left: rand() < 0.2,
      right: rand() < 0.2,
      jump: rand() < 0.05,
      boost: rand() < 0.3,
      drift: rand() < 0.1,
      pitchUp: rand() < 0.05,
      pitchDown: rand() < 0.05,
    });
  }
  return inputs;
}

function runInputs(bike: ReturnType<typeof createBike>, inputs: PlayerInput[], skipTrail: boolean): void {
  for (const inp of inputs) {
    bike.update(FIXED_DT, inp, [bike.trail], true, skipTrail);
  }
}

describe('SimBike replay determinism', () => {
  it('snapshot → N inputs → state A; restore → same N inputs → state A', () => {
    const bike = createBike({ x: 5, z: -15, angle: 0.7 });
    const inputs = makeInputs(90, 42);

    const before = bike.snapshot();
    runInputs(bike, inputs, true);
    const afterA = bike.snapshot();

    bike.restore(before);
    runInputs(bike, inputs, true);
    const afterB = bike.snapshot();

    expect(afterB).toEqual(afterA);
  });

  it('holds across ground, wall-attach, and flight state transitions', () => {
    // Start at arena edge, boost into the wall, then up — exercises attach.
    const bike = createBike({ x: 0, z: 0, angle: 0 });
    const inputs: PlayerInput[] = [];
    for (let i = 0; i < 60; i++) inputs.push({ ...NO_INPUT, boost: true });
    for (let i = 0; i < 30; i++) inputs.push({ ...NO_INPUT, jump: i === 0, boost: true, pitchUp: true });
    for (let i = 0; i < 30; i++) inputs.push({ ...NO_INPUT, left: true, boost: true });

    const before = bike.snapshot();
    runInputs(bike, inputs, true);
    const afterA = bike.snapshot();

    bike.restore(before);
    runInputs(bike, inputs, true);
    const afterB = bike.snapshot();

    expect(afterB).toEqual(afterA);
  });

  it('partial replay: snapshot at step K, run remaining; matches running all straight through', () => {
    const bike = createBike({ x: -20, z: 0, angle: Math.PI * 0.25 });
    const inputs = makeInputs(120, 7);
    const splitAt = 45;

    // Reference run: everything straight through.
    const ref = createBike({ x: -20, z: 0, angle: Math.PI * 0.25 });
    runInputs(ref, inputs, true);
    const refFinal = ref.snapshot();

    // Replay run: run first splitAt, snapshot, then run remainder.
    runInputs(bike, inputs.slice(0, splitAt), true);
    const mid = bike.snapshot();

    // Restore to mid (no-op, but tests restore from self-state), run remainder.
    bike.restore(mid);
    runInputs(bike, inputs.slice(splitAt), true);
    const replayFinal = bike.snapshot();

    expect(replayFinal).toEqual(refFinal);
  });
});
