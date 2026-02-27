import { Vec3, SurfaceType, getSurfaceNormal } from '@tron/shared';
import { ARENA_HALF } from '@tron/shared';

/** Rodrigues' rotation formula: rotate vector v around unit axis k by angle theta */
export function rotateVectorAroundAxis(v: Vec3, k: Vec3, theta: number): Vec3 {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  // v*cos + (k x v)*sin + k*(k.v)*(1-cos)
  const dot = k.x * v.x + k.y * v.y + k.z * v.z;
  return {
    x: v.x * cosT + (k.y * v.z - k.z * v.y) * sinT + k.x * dot * (1 - cosT),
    y: v.y * cosT + (k.z * v.x - k.x * v.z) * sinT + k.y * dot * (1 - cosT),
    z: v.z * cosT + (k.x * v.y - k.y * v.x) * sinT + k.z * dot * (1 - cosT),
  };
}

/** Project a vector onto a surface plane (remove the normal component) and renormalize */
export function projectOntoSurfacePlane(v: Vec3, normal: Vec3): Vec3 {
  const dot = v.x * normal.x + v.y * normal.y + v.z * normal.z;
  const proj = {
    x: v.x - dot * normal.x,
    y: v.y - dot * normal.y,
    z: v.z - dot * normal.z,
  };
  const len = Math.sqrt(proj.x * proj.x + proj.y * proj.y + proj.z * proj.z);
  if (len < 0.001) return { x: 0, y: 0, z: 0 };
  return { x: proj.x / len, y: proj.y / len, z: proj.z / len };
}

/**
 * Remap forward vector when transitioning from floor to a wall.
 * The toward-wall velocity component becomes the upward component on the wall.
 */
export function remapForwardToWall(forward: Vec3, wallSurface: SurfaceType): Vec3 {
  const wallNormal = getSurfaceNormal(wallSurface);
  // The component of forward toward the wall (dot with -wallNormal, since wallNormal points inward)
  // becomes the Y component on the wall
  switch (wallSurface) {
    case SurfaceType.WallXPos:
      // Wall at +x, normal=(-1,0,0). forward.x (positive = toward wall) becomes upward
      return normalize({ x: 0, y: forward.x, z: forward.z });
    case SurfaceType.WallXNeg:
      // Wall at -x, normal=(1,0,0). forward.x (negative = toward wall) becomes upward (negate)
      return normalize({ x: 0, y: -forward.x, z: forward.z });
    case SurfaceType.WallZPos:
      // Wall at +z, normal=(0,0,-1). forward.z (positive = toward wall) becomes upward
      return normalize({ x: forward.x, y: forward.z, z: 0 });
    case SurfaceType.WallZNeg:
      // Wall at -z, normal=(0,0,1). forward.z (negative = toward wall) becomes upward (negate)
      return normalize({ x: forward.x, y: -forward.z, z: 0 });
    default:
      return forward;
  }
}

/**
 * Remap forward vector when transitioning from wall to floor.
 * Remove Y component, renormalize. If near-zero, default to heading away from wall.
 */
export function remapForwardToFloor(forward: Vec3, wallSurface: SurfaceType): Vec3 {
  const floorForward = { x: forward.x, y: 0, z: forward.z };
  const len = Math.sqrt(floorForward.x * floorForward.x + floorForward.z * floorForward.z);
  if (len < 0.001) {
    // Was going straight up/down on wall - default to heading away from wall
    const normal = getSurfaceNormal(wallSurface);
    return { x: normal.x, y: 0, z: normal.z };
  }
  return { x: floorForward.x / len, y: 0, z: floorForward.z / len };
}

/** Determine which wall surface a position is at, if any */
export function getWallSurfaceFromPosition(x: number, z: number): SurfaceType | null {
  const margin = 0.5;
  if (x >= ARENA_HALF - margin) return SurfaceType.WallXPos;
  if (x <= -ARENA_HALF + margin) return SurfaceType.WallXNeg;
  if (z >= ARENA_HALF - margin) return SurfaceType.WallZPos;
  if (z <= -ARENA_HALF + margin) return SurfaceType.WallZNeg;
  return null;
}

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 0.001) return { x: 0, y: 1, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
