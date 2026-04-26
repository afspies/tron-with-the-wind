import { describe, expect, it } from 'vitest';
import { SurfaceType, NET_TICK_DURATION_MS, type BikeSnapshot, type GameSnapshot } from '@tron/shared';
import { SnapshotBuffer } from '../SnapshotBuffer';

function bike(overrides: Partial<BikeSnapshot> = {}): BikeSnapshot {
  return {
    slot: 0,
    x: 0,
    y: 0,
    z: 0,
    angle: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    alive: true,
    grounded: true,
    boostMeter: 3,
    boosting: false,
    invulnerable: false,
    invulnerableTimer: 0,
    doubleJumpCooldown: 0,
    drifting: false,
    velocityAngle: 0,
    pitch: 0,
    flying: false,
    surfaceType: SurfaceType.Floor,
    forwardX: 0,
    forwardY: 0,
    forwardZ: 1,
    ...overrides,
  };
}

function snapshot(tick: number, bikeState: BikeSnapshot): GameSnapshot {
  return {
    tick,
    serverTime: tick * NET_TICK_DURATION_MS,
    phase: 'playing',
    roundNumber: 1,
    roundsToWin: 3,
    bikes: [bikeState],
    trails: [],
    powerUps: [],
    scores: [0, 0, 0, 0],
    events: [],
  };
}

describe('SnapshotBuffer', () => {
  it('ignores stale snapshots', () => {
    const buffer = new SnapshotBuffer();

    expect(buffer.addSnapshot(snapshot(2, bike({ x: 20 })))).toBe(true);
    expect(buffer.addSnapshot(snapshot(1, bike({ x: 10 })))).toBe(false);

    expect(buffer.sampleAt(2)?.bikes[0].x).toBe(20);
  });

  it('interpolates across missing ticks with shortest-angle rotation', () => {
    const buffer = new SnapshotBuffer();
    buffer.addSnapshot(snapshot(10, bike({ x: 0, angle: Math.PI - 0.1 })));
    buffer.addSnapshot(snapshot(13, bike({ x: 30, angle: -Math.PI + 0.1 })));

    const sampled = buffer.sampleAt(11.5)!;

    expect(sampled.bikes[0].x).toBeCloseTo(15);
    expect(Math.abs(sampled.bikes[0].angle)).toBeCloseTo(Math.PI, 1);
  });

  it('caps extrapolation at one tick', () => {
    const buffer = new SnapshotBuffer();
    buffer.addSnapshot(snapshot(5, bike({ x: 10, vx: 30 })));

    const sampled = buffer.sampleAt(20)!;
    const oneTickMeters = 30 * (NET_TICK_DURATION_MS / 1000);

    expect(sampled.bikes[0].x).toBeCloseTo(10 + oneTickMeters);
  });
});
