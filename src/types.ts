import * as THREE from 'three';

export type GameState = 'MENU' | 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'ROUND_END' | 'GAME_OVER';

export type AIDifficulty = 'easy' | 'medium' | 'hard';

export interface PlayerConfig {
  id: number;
  name: string;
  color: string;
  isAI: boolean;
  aiDifficulty?: AIDifficulty;
}

export interface BikeState {
  position: THREE.Vector3;
  angle: number;
  speed: number;
  vy: number;
  alive: boolean;
  grounded: boolean;
  jumpCooldown: number;
}

export interface GameConfig {
  humanCount: number;
  aiCount: number;
  aiDifficulty: AIDifficulty;
  roundsToWin: number;
  mode: 'quickplay' | 'online';
  localSlot?: number;
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
