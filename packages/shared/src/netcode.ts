import { NET_TICK_DURATION_MS } from './constants';
import { SurfaceType, wrapAngle, type PlayerInput, type TrailPoint } from './types';

export const INPUT_LEFT = 1 << 0;
export const INPUT_RIGHT = 1 << 1;
export const INPUT_JUMP = 1 << 2;
export const INPUT_BOOST = 1 << 3;
export const INPUT_DRIFT = 1 << 4;
export const INPUT_PITCH_UP = 1 << 5;
export const INPUT_PITCH_DOWN = 1 << 6;

export const SNAPSHOT_INTERPOLATION_TICKS = 2;
export const SNAPSHOT_MAX_EXTRAPOLATION_TICKS = 1;

export interface InputFrame {
  seq: number;
  buttons: number;
  clientTime: number;
}

export interface BikeSnapshot {
  slot: number;
  x: number;
  y: number;
  z: number;
  angle: number;
  vx: number;
  vy: number;
  vz: number;
  alive: boolean;
  grounded: boolean;
  boostMeter: number;
  boosting: boolean;
  invulnerable: boolean;
  invulnerableTimer: number;
  doubleJumpCooldown: number;
  drifting: boolean;
  velocityAngle: number;
  pitch: number;
  flying: boolean;
  surfaceType: SurfaceType;
  forwardX: number;
  forwardY: number;
  forwardZ: number;
}

export interface TrailPointWire {
  x: number;
  y: number;
  z: number;
  gap?: boolean;
}

export interface TrailUpdate {
  slot: number;
  revision: number;
  mode: 'append' | 'replace';
  from: number;
  points: TrailPointWire[];
}

export interface PowerUpSnapshot {
  id: number;
  type: string;
  x: number;
  z: number;
  active: boolean;
}

export type GameEvent =
  | { type: 'bike-death'; tick: number; slot: number; x: number; y: number; z: number }
  | { type: 'round-reset'; tick: number; roundNumber: number }
  | { type: 'round-end'; tick: number; winnerIndex: number }
  | {
      type: 'powerup-spawn';
      tick: number;
      powerupId: number;
      powerupX: number;
      powerupZ: number;
      powerupType: string;
    }
  | {
      type: 'powerup-pickup';
      tick: number;
      powerupId: number;
      bikeIndex: number;
      powerupType: string;
    }
  | {
      type: 'trail-destroy';
      tick: number;
      trailIndex: number;
      destroyX: number;
      destroyZ: number;
      destroyRadius: number;
    };

export interface GameSnapshot {
  tick: number;
  serverTime: number;
  phase: string;
  roundNumber: number;
  roundsToWin: number;
  bikes: BikeSnapshot[];
  trails: TrailUpdate[];
  powerUps: PowerUpSnapshot[];
  scores: number[];
  events: GameEvent[];
}

export interface InterpolatedSnapshot {
  tick: number;
  latestTick: number;
  bikes: BikeSnapshot[];
  powerUps: PowerUpSnapshot[];
  scores: number[];
  roundNumber: number;
  roundsToWin: number;
}

export function packPlayerInput(input: PlayerInput): number {
  let buttons = 0;
  if (input.left) buttons |= INPUT_LEFT;
  if (input.right) buttons |= INPUT_RIGHT;
  if (input.jump) buttons |= INPUT_JUMP;
  if (input.boost) buttons |= INPUT_BOOST;
  if (input.drift) buttons |= INPUT_DRIFT;
  if (input.pitchUp) buttons |= INPUT_PITCH_UP;
  if (input.pitchDown) buttons |= INPUT_PITCH_DOWN;
  return buttons;
}

export function unpackPlayerInput(buttons: number): PlayerInput {
  return {
    left: (buttons & INPUT_LEFT) !== 0,
    right: (buttons & INPUT_RIGHT) !== 0,
    jump: (buttons & INPUT_JUMP) !== 0,
    boost: (buttons & INPUT_BOOST) !== 0,
    drift: (buttons & INPUT_DRIFT) !== 0,
    pitchUp: (buttons & INPUT_PITCH_UP) !== 0,
    pitchDown: (buttons & INPUT_PITCH_DOWN) !== 0,
  };
}

export function toTrailPointWire(point: TrailPoint): TrailPointWire {
  if (Number.isNaN(point.x) || Number.isNaN(point.y) || Number.isNaN(point.z)) {
    return { x: 0, y: 0, z: 0, gap: true };
  }
  return { x: point.x, y: point.y, z: point.z };
}

export function fromTrailPointWire(point: TrailPointWire): TrailPoint {
  if (point.gap) {
    return { x: NaN, y: NaN, z: NaN };
  }
  return { x: point.x, y: point.y, z: point.z };
}

export function interpolateBikeSnapshot(a: BikeSnapshot, b: BikeSnapshot, t: number): BikeSnapshot {
  const pick = t < 0.5 ? a : b;
  return {
    ...pick,
    slot: a.slot,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    angle: a.angle + wrapAngle(b.angle - a.angle) * t,
    vx: a.vx + (b.vx - a.vx) * t,
    vy: a.vy + (b.vy - a.vy) * t,
    vz: a.vz + (b.vz - a.vz) * t,
    boostMeter: a.boostMeter + (b.boostMeter - a.boostMeter) * t,
    invulnerableTimer: a.invulnerableTimer + (b.invulnerableTimer - a.invulnerableTimer) * t,
    doubleJumpCooldown: a.doubleJumpCooldown + (b.doubleJumpCooldown - a.doubleJumpCooldown) * t,
    velocityAngle: a.velocityAngle + wrapAngle(b.velocityAngle - a.velocityAngle) * t,
    pitch: a.pitch + (b.pitch - a.pitch) * t,
    forwardX: a.forwardX + (b.forwardX - a.forwardX) * t,
    forwardY: a.forwardY + (b.forwardY - a.forwardY) * t,
    forwardZ: a.forwardZ + (b.forwardZ - a.forwardZ) * t,
    alive: pick.alive,
    grounded: pick.grounded,
    boosting: pick.boosting,
    invulnerable: pick.invulnerable,
    drifting: pick.drifting,
    flying: pick.flying,
    surfaceType: pick.surfaceType,
  };
}

export function extrapolateBikeSnapshot(snapshot: BikeSnapshot, tickDelta: number): BikeSnapshot {
  const cappedTicks = Math.min(Math.max(tickDelta, 0), SNAPSHOT_MAX_EXTRAPOLATION_TICKS);
  const seconds = cappedTicks * (NET_TICK_DURATION_MS / 1000);
  return {
    ...snapshot,
    x: snapshot.x + snapshot.vx * seconds,
    y: snapshot.y + snapshot.vy * seconds,
    z: snapshot.z + snapshot.vz * seconds,
  };
}
