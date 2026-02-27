// Arena surface model — pure math, used by both server and client
import { ARENA_HALF, CURVE_RADIUS, CEILING_HEIGHT } from './constants';
import type { Vec3 } from './types';

export enum SurfaceId {
  FLOOR,
  WALL_POS_X,
  WALL_NEG_X,
  WALL_POS_Z,
  WALL_NEG_Z,
  CURVE_PX,
  CURVE_NX,
  CURVE_PZ,
  CURVE_NZ,
  CEILING,
  OUT_OF_BOUNDS,
}

export interface SurfaceInfo {
  surfaceId: SurfaceId;
  normal: Vec3;        // inward-facing surface normal
  contactPoint: Vec3;  // nearest point on surface
  distance: number;    // signed distance from surface (negative = inside surface)
  drivable: boolean;   // can bikes stick to this surface?
}

const R = CURVE_RADIUS;
const HALF = ARENA_HALF;
// Flat floor/wall extents (inside the curves)
const FLAT_HALF = HALF - R;

export function isDrivable(surfaceId: SurfaceId): boolean {
  return surfaceId === SurfaceId.FLOOR
    || surfaceId === SurfaceId.WALL_POS_X
    || surfaceId === SurfaceId.WALL_NEG_X
    || surfaceId === SurfaceId.WALL_POS_Z
    || surfaceId === SurfaceId.WALL_NEG_Z
    || surfaceId === SurfaceId.CURVE_PX
    || surfaceId === SurfaceId.CURVE_NX
    || surfaceId === SurfaceId.CURVE_PZ
    || surfaceId === SurfaceId.CURVE_NZ;
}

/**
 * Compute the nearest surface info for a 3D position inside the arena.
 * The arena is a rounded rectangular box viewed from inside:
 * - Floor at Y=0
 * - Quarter-cylinder curves at floor-wall boundaries (radius R)
 * - Vertical walls from Y=R to Y=CEILING_HEIGHT-R
 * - Top curves connecting walls to ceiling
 * - Ceiling at Y=CEILING_HEIGHT
 */
export function computeSurfaceInfo(pos: Vec3): SurfaceInfo {
  const ax = Math.abs(pos.x);
  const az = Math.abs(pos.z);
  const sx = pos.x >= 0 ? 1 : -1;
  const sz = pos.z >= 0 ? 1 : -1;

  // Determine which zone we're in based on X and Z relative to curve boundaries
  const inXCurve = ax > FLAT_HALF;
  const inZCurve = az > FLAT_HALF;
  const y = pos.y;

  // --- Vertical corner zone (both X and Z in curve region) ---
  if (inXCurve && inZCurve) {
    // Vertical corner where two walls meet — bounce zone
    // Find nearest wall and use that
    const dxWall = HALF - ax;
    const dzWall = HALF - az;
    if (dxWall < dzWall) {
      return makeWallInfoX(pos, sx, ax);
    } else {
      return makeWallInfoZ(pos, sz, az);
    }
  }

  // --- X curve/wall zone ---
  if (inXCurve) {
    return handleXBoundary(pos, sx, ax, y);
  }

  // --- Z curve/wall zone ---
  if (inZCurve) {
    return handleZBoundary(pos, sz, az, y);
  }

  // --- Interior: floor or ceiling ---
  if (y <= CEILING_HEIGHT * 0.5) {
    // Closer to floor
    return {
      surfaceId: SurfaceId.FLOOR,
      normal: { x: 0, y: 1, z: 0 },
      contactPoint: { x: pos.x, y: 0, z: pos.z },
      distance: y,
      drivable: true,
    };
  } else {
    // Closer to ceiling
    return {
      surfaceId: SurfaceId.CEILING,
      normal: { x: 0, y: -1, z: 0 },
      contactPoint: { x: pos.x, y: CEILING_HEIGHT, z: pos.z },
      distance: CEILING_HEIGHT - y,
      drivable: false,
    };
  }
}

function handleXBoundary(pos: Vec3, sx: number, ax: number, y: number): SurfaceInfo {
  const curveId = sx > 0 ? SurfaceId.CURVE_PX : SurfaceId.CURVE_NX;
  const wallId = sx > 0 ? SurfaceId.WALL_POS_X : SurfaceId.WALL_NEG_X;

  // Bottom curve zone: Y < R
  if (y < R) {
    const cx = FLAT_HALF; // curve center X (absolute)
    const cy = R;         // curve center Y
    const dx = ax - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1e-6) {
      // At curve center — default to floor normal
      return {
        surfaceId: curveId,
        normal: { x: 0, y: 1, z: 0 },
        contactPoint: { x: pos.x, y: 0, z: pos.z },
        distance: y,
        drivable: true,
      };
    }

    const nx = (dx / dist) * -sx;
    const ny = dy / dist;
    // Contact point on the curve surface
    const cpx = (cx + dx / dist * R) * sx;
    const cpy = cy + dy / dist * R;

    return {
      surfaceId: curveId,
      normal: { x: nx, y: ny, z: 0 },
      contactPoint: { x: cpx, y: cpy, z: pos.z },
      distance: R - dist,
      drivable: true,
    };
  }

  // Top curve zone: Y > CEILING_HEIGHT - R
  if (y > CEILING_HEIGHT - R) {
    const cx = FLAT_HALF;
    const cy = CEILING_HEIGHT - R;
    const dx = ax - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1e-6) {
      return {
        surfaceId: SurfaceId.CEILING,
        normal: { x: 0, y: -1, z: 0 },
        contactPoint: { x: pos.x, y: CEILING_HEIGHT, z: pos.z },
        distance: CEILING_HEIGHT - y,
        drivable: false,
      };
    }

    const nx = (dx / dist) * -sx;
    const ny = dy / dist;
    const cpx = (cx + dx / dist * R) * sx;
    const cpy = cy + dy / dist * R;

    return {
      surfaceId: SurfaceId.CEILING, // top curves are bounce zones
      normal: { x: nx, y: ny, z: 0 },
      contactPoint: { x: cpx, y: cpy, z: pos.z },
      distance: R - dist,
      drivable: false,
    };
  }

  // Wall zone: R <= Y <= CEILING_HEIGHT - R
  return makeWallInfoX(pos, sx, ax);
}

function makeWallInfoX(pos: Vec3, sx: number, ax: number): SurfaceInfo {
  const wallId = sx > 0 ? SurfaceId.WALL_POS_X : SurfaceId.WALL_NEG_X;
  const dist = HALF - ax;
  return {
    surfaceId: wallId,
    normal: { x: -sx, y: 0, z: 0 },
    contactPoint: { x: HALF * sx, y: pos.y, z: pos.z },
    distance: dist,
    drivable: true,
  };
}

function handleZBoundary(pos: Vec3, sz: number, az: number, y: number): SurfaceInfo {
  const curveId = sz > 0 ? SurfaceId.CURVE_PZ : SurfaceId.CURVE_NZ;
  const wallId = sz > 0 ? SurfaceId.WALL_POS_Z : SurfaceId.WALL_NEG_Z;

  // Bottom curve zone: Y < R
  if (y < R) {
    const cz = FLAT_HALF;
    const cy = R;
    const dz = az - cz;
    const dy = y - cy;
    const dist = Math.sqrt(dz * dz + dy * dy);

    if (dist < 1e-6) {
      return {
        surfaceId: curveId,
        normal: { x: 0, y: 1, z: 0 },
        contactPoint: { x: pos.x, y: 0, z: pos.z },
        distance: y,
        drivable: true,
      };
    }

    const nz = (dz / dist) * -sz;
    const ny = dy / dist;
    const cpz = (cz + dz / dist * R) * sz;
    const cpy = cy + dy / dist * R;

    return {
      surfaceId: curveId,
      normal: { x: 0, y: ny, z: nz },
      contactPoint: { x: pos.x, y: cpy, z: cpz },
      distance: R - dist,
      drivable: true,
    };
  }

  // Top curve zone: Y > CEILING_HEIGHT - R
  if (y > CEILING_HEIGHT - R) {
    const cz = FLAT_HALF;
    const cy = CEILING_HEIGHT - R;
    const dz = az - cz;
    const dy = y - cy;
    const dist = Math.sqrt(dz * dz + dy * dy);

    if (dist < 1e-6) {
      return {
        surfaceId: SurfaceId.CEILING,
        normal: { x: 0, y: -1, z: 0 },
        contactPoint: { x: pos.x, y: CEILING_HEIGHT, z: pos.z },
        distance: CEILING_HEIGHT - y,
        drivable: false,
      };
    }

    const nz = (dz / dist) * -sz;
    const ny = dy / dist;
    const cpz = (cz + dz / dist * R) * sz;
    const cpy = cy + dy / dist * R;

    return {
      surfaceId: SurfaceId.CEILING,
      normal: { x: 0, y: ny, z: nz },
      contactPoint: { x: pos.x, y: cpy, z: cpz },
      distance: R - dist,
      drivable: false,
    };
  }

  // Wall zone: R <= Y <= CEILING_HEIGHT - R
  return makeWallInfoZ(pos, sz, az);
}

function makeWallInfoZ(pos: Vec3, sz: number, az: number): SurfaceInfo {
  const wallId = sz > 0 ? SurfaceId.WALL_POS_Z : SurfaceId.WALL_NEG_Z;
  const dist = HALF - az;
  return {
    surfaceId: wallId,
    normal: { x: 0, y: 0, z: -sz },
    contactPoint: { x: pos.x, y: pos.y, z: HALF * sz },
    distance: dist,
    drivable: true,
  };
}

/** Snap a position to the nearest point on the given surface. */
export function snapToSurface(pos: Vec3, info: SurfaceInfo): Vec3 {
  return {
    x: pos.x + info.normal.x * -info.distance,
    y: pos.y + info.normal.y * -info.distance,
    z: pos.z + info.normal.z * -info.distance,
  };
}

/** Get surface info at a trail point position (for determining trail extrusion direction). */
export function getSurfaceNormalAtPoint(pos: Vec3): Vec3 {
  return computeSurfaceInfo(pos).normal;
}
