import type { Vec3 } from '@tron/shared';
import { SurfaceType, ARENA_HALF, CEILING_HEIGHT, RAMP_RADIUS, GRAVITY } from '@tron/shared';

export interface SurfaceInfo {
  normal: Vec3;
  constrainedPos: Vec3;
  surfaceType: SurfaceType;
}

/**
 * Compute the arena surface info (normal, constrained position, surface type) for any 3D position.
 * The arena is a box with quarter-circle filleted edges (radius RAMP_RADIUS) at all
 * floor-wall and wall-ceiling junctions. The normal varies continuously through the ramps.
 */
export function getArenaSurfaceInfo(pos: Vec3): SurfaceInfo {
  const R = RAMP_RADIUS;

  // Distances to each boundary
  const dFloor = pos.y;
  const dCeiling = CEILING_HEIGHT - pos.y;
  const dXPos = ARENA_HALF - pos.x;
  const dXNeg = pos.x + ARENA_HALF;
  const dZPos = ARENA_HALF - pos.z;
  const dZNeg = pos.z + ARENA_HALF;

  // Find nearest wall
  let wallDist = dXPos;
  let wallAxis: 0 | 1 = 0; // 0 = x-wall, 1 = z-wall
  let wallSign = 1; // +1 for positive side, -1 for negative

  if (dXNeg < wallDist) { wallDist = dXNeg; wallAxis = 0; wallSign = -1; }
  if (dZPos < wallDist) { wallDist = dZPos; wallAxis = 1; wallSign = 1; }
  if (dZNeg < wallDist) { wallDist = dZNeg; wallAxis = 1; wallSign = -1; }

  // Floor-wall ramp zone: close to both a wall and the floor
  if (wallDist < R && dFloor < R) {
    return computeRamp(pos, wallAxis, wallSign, R, 'floor');
  }

  // Wall-ceiling ramp zone: close to both a wall and the ceiling
  if (wallDist < R && dCeiling < R) {
    return computeRamp(pos, wallAxis, wallSign, R, 'ceiling');
  }

  // Flat wall (between ramp zones, above floor ramp and below ceiling ramp)
  if (wallDist < dFloor && wallDist < dCeiling) {
    return computeFlatWall(pos, wallAxis, wallSign);
  }

  // Flat floor
  if (dFloor <= dCeiling) {
    return {
      normal: { x: 0, y: 1, z: 0 },
      constrainedPos: { x: pos.x, y: 0, z: pos.z },
      surfaceType: SurfaceType.Floor,
    };
  }

  // Flat ceiling (bounce surface, not driveable -- represented as Air)
  return {
    normal: { x: 0, y: -1, z: 0 },
    constrainedPos: { x: pos.x, y: CEILING_HEIGHT, z: pos.z },
    surfaceType: SurfaceType.Air,
  };
}

function computeRamp(
  pos: Vec3,
  wallAxis: 0 | 1, // 0 = x-wall, 1 = z-wall
  wallSign: number,
  R: number,
  edge: 'floor' | 'ceiling',
): SurfaceInfo {
  // Quarter-circle arc center:
  // For floor ramp: center is at (wallPos - sign*R, R) in the wall-axis/Y plane
  // For ceiling ramp: center is at (wallPos - sign*R, CEILING_HEIGHT - R)
  const wallPos = wallSign * ARENA_HALF;
  const centerW = wallPos - wallSign * R;
  const centerY = edge === 'floor' ? R : CEILING_HEIGHT - R;

  // Bike's position in the wall-axis coordinate
  const posW = wallAxis === 0 ? pos.x : pos.z;

  // Vector from center to position in the 2D plane (wallCoord, Y)
  const dw = posW - centerW;
  const dy = pos.y - centerY;
  const dist = Math.sqrt(dw * dw + dy * dy);

  let nw: number, nY: number;
  if (dist < 0.001) {
    // At center -- use 45-degree default
    nw = -wallSign * 0.7071;
    nY = edge === 'floor' ? 0.7071 : -0.7071;
  } else {
    // Normal = normalize(center - pos) in 2D
    nw = -dw / dist;
    nY = -dy / dist;
  }

  // Constrained position on the arc surface: center - R * normal (in 2D)
  const constrainedW = centerW - R * nw;
  const constrainedY = centerY - R * nY;

  // Map back to 3D
  let normal: Vec3;
  let constrainedPos: Vec3;

  if (wallAxis === 0) {
    normal = { x: nw, y: nY, z: 0 };
    constrainedPos = { x: constrainedW, y: constrainedY, z: pos.z };
  } else {
    normal = { x: 0, y: nY, z: nw };
    constrainedPos = { x: pos.x, y: constrainedY, z: constrainedW };
  }

  return { normal, constrainedPos, surfaceType: deriveSurfaceType(normal) };
}

function computeFlatWall(pos: Vec3, wallAxis: 0 | 1, wallSign: number): SurfaceInfo {
  const wallPos = wallSign * ARENA_HALF;

  if (wallAxis === 0) {
    const surfaceType = wallSign > 0 ? SurfaceType.WallXPos : SurfaceType.WallXNeg;
    return {
      normal: { x: -wallSign, y: 0, z: 0 },
      constrainedPos: { x: wallPos, y: pos.y, z: pos.z },
      surfaceType,
    };
  } else {
    const surfaceType = wallSign > 0 ? SurfaceType.WallZPos : SurfaceType.WallZNeg;
    return {
      normal: { x: 0, y: 0, z: -wallSign },
      constrainedPos: { x: pos.x, y: pos.y, z: wallPos },
      surfaceType,
    };
  }
}

/** Derive surface type from a continuous surface normal */
export function deriveSurfaceType(normal: Vec3): SurfaceType {
  if (normal.y > 0.7) return SurfaceType.Floor;
  if (normal.y < -0.7) return SurfaceType.Air; // ceiling-like
  const absNx = Math.abs(normal.x);
  const absNz = Math.abs(normal.z);
  if (absNx >= absNz) {
    return normal.x < 0 ? SurfaceType.WallXPos : SurfaceType.WallXNeg;
  }
  return normal.z < 0 ? SurfaceType.WallZPos : SurfaceType.WallZNeg;
}

/** Compute the tangential component of gravity on a surface with the given normal */
export function getGravityTangent(normal: Vec3): Vec3 {
  // gravity = (0, -GRAVITY, 0)
  // tangent = gravity - (gravity . normal) * normal
  const dot = -GRAVITY * normal.y; // (0,-G,0) . normal = -G * ny
  return {
    x: -dot * normal.x, // 0 - dot * nx = G * ny * nx
    y: -GRAVITY - dot * normal.y, // -G - dot * ny = -G + G * ny^2 = -G(1 - ny^2)
    z: -dot * normal.z, // 0 - dot * nz = G * ny * nz
  };
}

/** Check if a position is inside the arena bounds (with small margin) */
export function isInsideArena(pos: Vec3): boolean {
  return Math.abs(pos.x) <= ARENA_HALF + 0.5
    && Math.abs(pos.z) <= ARENA_HALF + 0.5
    && pos.y >= -0.5
    && pos.y <= CEILING_HEIGHT + 0.5;
}

/** Check if a position is in the "near surface" zone (within snap distance of the arena boundary) */
export function isNearSurface(pos: Vec3, threshold: number): boolean {
  const info = getArenaSurfaceInfo(pos);
  const dx = pos.x - info.constrainedPos.x;
  const dy = pos.y - info.constrainedPos.y;
  const dz = pos.z - info.constrainedPos.z;
  return dx * dx + dy * dy + dz * dz < threshold * threshold;
}
