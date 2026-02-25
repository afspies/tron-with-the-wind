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
}

export const NO_INPUT: PlayerInput = { left: false, right: false, jump: false, boost: false, drift: false };

export interface GameConfig {
  humanCount: number;
  aiCount: number;
  aiDifficulty: AIDifficulty;
  roundsToWin: number;
  mode: 'quickplay' | 'online';
  localSlot?: number;
}
