import type { PlayerInput, Vec3 } from '@tron/shared';
import { NO_INPUT } from '@tron/shared';
import { SimBike } from '../SimBike.js';

export function createBike(opts: {
  x?: number; z?: number; angle?: number;
  playerIndex?: number; color?: string;
} = {}): SimBike {
  const { x = 0, z = 0, angle = 0, playerIndex = 0, color = '#fff' } = opts;
  return new SimBike(playerIndex, color, x, z, angle);
}

export function input(keys: Partial<PlayerInput> = {}): PlayerInput {
  return { ...NO_INPUT, ...keys };
}

export function tickN(bike: SimBike, n: number, inp: PlayerInput = NO_INPUT, dt = 1 / 60): SimBike {
  for (let i = 0; i < n; i++) {
    bike.update(dt, inp, [bike.trail]);
  }
  return bike;
}

/** Extract an applyServerState-compatible snapshot from a SimBike. */
export function snapshot(bike: SimBike) {
  return {
    x: bike.position.x,
    y: bike.position.y,
    z: bike.position.z,
    angle: bike.angle,
    vx: bike.vx,
    vz: bike.vz,
    vy: bike.vy,
    alive: bike.alive,
    grounded: bike.grounded,
    boosting: bike.boosting,
    boostMeter: bike.boostMeter,
    drifting: bike.drifting,
    velocityAngle: bike.velocityAngle,
    pitch: bike.pitch,
    flying: bike.flying,
    surfaceType: bike.surfaceType as number,
    forwardX: bike.forward.x,
    forwardY: bike.forward.y,
    forwardZ: bike.forward.z,
    doubleJumpCooldown: bike.doubleJumpCooldown,
    invulnerable: bike.invulnerable,
    invulnerableTimer: bike.invulnerableTimer,
  };
}

/** Tick until a condition is met, or up to maxTicks (default 120). */
export function tickUntil(
  bike: SimBike,
  predicate: (b: SimBike) => boolean,
  maxTicks = 120,
  dt = 1 / 60,
): SimBike {
  for (let i = 0; i < maxTicks; i++) {
    bike.update(dt, NO_INPUT, [bike.trail]);
    if (predicate(bike)) break;
  }
  return bike;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
