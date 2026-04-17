export enum SurfaceType {
  Floor = 0,
  WallXPos = 1,
  WallXNeg = 2,
  WallZPos = 3,
  WallZNeg = 4,
  Air = 5,
}

export type GamePhase = 'lobby' | 'countdown' | 'playing' | 'roundEnd' | 'gameOver';

export type GameState = 'MENU' | 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'ROUND_END' | 'GAME_OVER';

export type AIDifficulty = 'easy' | 'medium' | 'hard';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

export interface TrailPoint {
  x: number;
  y: number;
  z: number;
}

export interface PlayerInput {
  left: boolean;
  right: boolean;
  jump: boolean;
  boost: boolean;
  drift: boolean;
  pitchUp: boolean;
  pitchDown: boolean;
  /**
   * Client-assigned monotonic sequence number. The server echoes back the
   * last-processed seq on `BikeSchema.lastInputSeq` so the client can replay
   * still-unacked inputs after a rewind. Optional — AI/offline callers omit it.
   */
  inputSeq?: number;
}

export const NO_INPUT: PlayerInput = { left: false, right: false, jump: false, boost: false, drift: false, pitchUp: false, pitchDown: false };

export interface GameConfig {
  humanCount: number;
  aiCount: number;
  aiDifficulty: AIDifficulty;
  roundsToWin: number;
  mode: 'quickplay' | 'online' | 'tutorial';
  localSlot?: number;
}

export function wrapAngle(diff: number): number {
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

export function getSurfaceNormal(surface: SurfaceType): Vec3 {
  switch (surface) {
    case SurfaceType.Floor: return { x: 0, y: 1, z: 0 };
    case SurfaceType.WallXPos: return { x: -1, y: 0, z: 0 };
    case SurfaceType.WallXNeg: return { x: 1, y: 0, z: 0 };
    case SurfaceType.WallZPos: return { x: 0, y: 0, z: -1 };
    case SurfaceType.WallZNeg: return { x: 0, y: 0, z: 1 };
    case SurfaceType.Air: return { x: 0, y: 1, z: 0 };
  }
}
