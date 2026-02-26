export type MapId = 'classic' | 'skybridge';

// Skybridge constants
export const SKYBRIDGE_PLATFORM_HEIGHT = 6.0;
export const SKYBRIDGE_PLATFORM_DEPTH = 70; // z: +30 to +100
export const SKYBRIDGE_PLATFORM_HALF_WIDTH = 50; // x: -50 to +50
export const SKYBRIDGE_RAMP_LENGTH = 20; // z: +10 to +30
export const SKYBRIDGE_RAMP_WIDTH = 20; // each ramp is 20 units wide

// Platform edges
const PLATFORM_Z_FRONT = 30; // front edge of platform (cliff)
const PLATFORM_Z_BACK = 100; // back wall
const PLATFORM_X_MIN = -50;
const PLATFORM_X_MAX = 50;

// Ramp positions
const RAMP_Z_START = 10; // ground level start
const RAMP_Z_END = 30; // meets platform
const LEFT_RAMP_X_MIN = -50;
const LEFT_RAMP_X_MAX = -30;
const RIGHT_RAMP_X_MIN = 30;
const RIGHT_RAMP_X_MAX = 50;

// Threshold for deciding if a bike is "on top" vs "under" the platform
const LEVEL_THRESHOLD = 3.0;

function getSkybridgeHeight(x: number, z: number, currentY: number): number {
  // Check if on left ramp
  if (
    x >= LEFT_RAMP_X_MIN && x <= LEFT_RAMP_X_MAX &&
    z >= RAMP_Z_START && z <= RAMP_Z_END
  ) {
    const rampT = (z - RAMP_Z_START) / (RAMP_Z_END - RAMP_Z_START);
    const rampHeight = rampT * SKYBRIDGE_PLATFORM_HEIGHT;
    // If bike is near ramp surface, return ramp height
    if (currentY >= rampHeight - LEVEL_THRESHOLD) {
      return rampHeight;
    }
    return 0; // driving under the ramp (unlikely but possible near edges)
  }

  // Check if on right ramp
  if (
    x >= RIGHT_RAMP_X_MIN && x <= RIGHT_RAMP_X_MAX &&
    z >= RAMP_Z_START && z <= RAMP_Z_END
  ) {
    const rampT = (z - RAMP_Z_START) / (RAMP_Z_END - RAMP_Z_START);
    const rampHeight = rampT * SKYBRIDGE_PLATFORM_HEIGHT;
    if (currentY >= rampHeight - LEVEL_THRESHOLD) {
      return rampHeight;
    }
    return 0;
  }

  // Check if on platform
  if (
    x >= PLATFORM_X_MIN && x <= PLATFORM_X_MAX &&
    z >= PLATFORM_Z_FRONT && z <= PLATFORM_Z_BACK
  ) {
    // Near platform height -> on top; near ground -> underneath
    if (currentY >= SKYBRIDGE_PLATFORM_HEIGHT - LEVEL_THRESHOLD) {
      return SKYBRIDGE_PLATFORM_HEIGHT;
    }
    return 0; // driving underneath
  }

  return 0;
}

/**
 * Get terrain height at a position, considering the bike's current Y to
 * resolve multi-level terrain (on top of vs under platform).
 */
export function getTerrainHeight(mapId: MapId, x: number, z: number, currentY: number): number {
  if (mapId === 'classic') return 0;
  if (mapId === 'skybridge') return getSkybridgeHeight(x, z, currentY);
  return 0;
}

/**
 * Get terrain height for spawning - always returns the top surface.
 * Uses a high currentY so multi-level resolution picks the top.
 */
export function getSpawnTerrainHeight(mapId: MapId, x: number, z: number): number {
  return getTerrainHeight(mapId, x, z, 999);
}

export interface MapInfo {
  id: MapId;
  name: string;
  description: string;
}

export const MAP_INFO: MapInfo[] = [
  { id: 'classic', name: 'Classic', description: 'The original flat arena' },
  { id: 'skybridge', name: 'Skybridge', description: 'Elevated platform with ramps' },
];
