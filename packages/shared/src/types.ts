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
}

export const NO_INPUT: PlayerInput = { left: false, right: false, jump: false, boost: false };

export interface GameConfig {
  humanCount: number;
  aiCount: number;
  aiDifficulty: AIDifficulty;
  roundsToWin: number;
  mode: 'quickplay' | 'online';
  localSlot?: number;
}

// --- Game Events ---

export type DeathCause = 'trail' | 'wall' | 'self';

export interface DeathEvent {
  type: 'death';
  playerIndex: number;
  killerIndex: number; // -1 for wall/self
  cause: DeathCause;
  x: number;
  z: number;
}

export interface NearMissEvent {
  type: 'nearMiss';
  playerIndex: number;
  trailOwnerIndex: number;
  distance: number;
  x: number;
  z: number;
}

export interface RoundWinEvent {
  type: 'roundWin';
  winnerIndex: number;
  roundNumber: number;
}

export interface GameWinEvent {
  type: 'gameWin';
  winnerIndex: number;
}

export type GameEvent = DeathEvent | NearMissEvent | RoundWinEvent | GameWinEvent;
