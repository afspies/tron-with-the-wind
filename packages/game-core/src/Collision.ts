import type { Vec2, Vec3, TrailPoint } from '@tron/shared';
import { SurfaceType, ARENA_HALF, TRAIL_HEIGHT, TRAIL_SKIP_SEGMENTS, BIKE_COLLISION_HEIGHT, SELF_TRAIL_GRACE_RADIUS } from '@tron/shared';
import type { SimTrail } from './SimTrail';

/**
 * Returns true if a self-trail segment should be skipped for collision.
 * The grace radius prevents the bike from colliding with its own trail near
 * its current position, but only when the segment is at a different height
 * (e.g. flying over previously laid trail on the ground).
 */
function isOwnSegmentInGraceZone(
  p1: TrailPoint,
  p2: TrailPoint,
  bikeY: number,
  newPos: Vec2,
  graceSq: number,
): boolean {
  const avgSegY = (p1.y + p2.y) * 0.5;
  if (Math.abs(bikeY - avgSegY) <= BIKE_COLLISION_HEIGHT) return false;

  const dx0 = p1.x - newPos.x;
  const dz0 = p1.z - newPos.z;
  const dx1 = p2.x - newPos.x;
  const dz1 = p2.z - newPos.z;
  return dx0 * dx0 + dz0 * dz0 < graceSq && dx1 * dx1 + dz1 * dz1 < graceSq;
}

export function lineSegmentsIntersect(
  a1: Vec2, a2: Vec2,
  b1: Vec2, b2: Vec2,
): boolean {
  const d1x = a2.x - a1.x;
  const d1z = a2.z - a1.z;
  const d2x = b2.x - b1.x;
  const d2z = b2.z - b1.z;

  const cross = d1x * d2z - d1z * d2x;
  if (Math.abs(cross) < 1e-10) return false;

  const dx = b1.x - a1.x;
  const dz = b1.z - a1.z;

  const t = (dx * d2z - dz * d2x) / cross;
  const u = (dx * d1z - dz * d1x) / cross;

  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function lineSegmentIntersectParam(
  a1: Vec2, a2: Vec2,
  b1: Vec2, b2: Vec2,
): number {
  const d1x = a2.x - a1.x;
  const d1z = a2.z - a1.z;
  const d2x = b2.x - b1.x;
  const d2z = b2.z - b1.z;

  const cross = d1x * d2z - d1z * d2x;
  if (Math.abs(cross) < 1e-10) return -1;

  const dx = b1.x - a1.x;
  const dz = b1.z - a1.z;

  const t = (dx * d2z - dz * d2x) / cross;
  const u = (dx * d1z - dz * d1x) / cross;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return u;
  return -1;
}

export function checkTrailCollision(
  oldPos: Vec2,
  newPos: Vec2,
  bikeY: number,
  trails: SimTrail[],
  ownTrailIndex: number,
): boolean {
  return checkTrailCollisionDetailed(oldPos, newPos, bikeY, trails, ownTrailIndex) !== null;
}

export interface TrailHitInfo {
  trailIndex: number;
  contactX: number;
  contactZ: number;
}

export function checkTrailCollisionDetailed(
  oldPos: Vec2,
  newPos: Vec2,
  bikeY: number,
  trails: SimTrail[],
  ownTrailIndex: number,
): TrailHitInfo | null {
  const graceSq = SELF_TRAIL_GRACE_RADIUS * SELF_TRAIL_GRACE_RADIUS;

  for (let t = 0; t < trails.length; t++) {
    const trail = trails[t];
    const pts = trail.points;
    const isOwn = t === ownTrailIndex;
    const skipEnd = isOwn ? TRAIL_SKIP_SEGMENTS : 0;
    const endIdx = pts.length - 1 - skipEnd;

    for (let i = 0; i < endIdx; i++) {
      if (isNaN(pts[i].x) || isNaN(pts[i + 1].x)) continue;
      if (isOwn && isOwnSegmentInGraceZone(pts[i], pts[i + 1], bikeY, newPos, graceSq)) continue;

      const u = lineSegmentIntersectParam(oldPos, newPos, pts[i], pts[i + 1]);
      if (u < 0) continue;

      const trailY = pts[i].y + (pts[i + 1].y - pts[i].y) * u;
      if (bikeY < trailY + TRAIL_HEIGHT && bikeY + BIKE_COLLISION_HEIGHT > trailY) {
        const contactX = pts[i].x + (pts[i + 1].x - pts[i].x) * u;
        const contactZ = pts[i].z + (pts[i + 1].z - pts[i].z) * u;
        return { trailIndex: t, contactX, contactZ };
      }
    }
  }
  return null;
}

export function checkWallCollision(x: number, z: number): boolean {
  return Math.abs(x) > ARENA_HALF || Math.abs(z) > ARENA_HALF;
}

/**
 * Project a 3D point to 2D coordinates in a wall plane.
 * X-walls (WallXPos/WallXNeg): project to (z, y)
 * Z-walls (WallZPos/WallZNeg): project to (x, y)
 */
function projectToWallPlane(pos: Vec3, surfaceType: SurfaceType): Vec2 {
  switch (surfaceType) {
    case SurfaceType.WallXPos:
    case SurfaceType.WallXNeg:
      return { x: pos.z, z: pos.y }; // Using Vec2's x,z as the 2D coordinates
    case SurfaceType.WallZPos:
    case SurfaceType.WallZNeg:
      return { x: pos.x, z: pos.y };
    default:
      return { x: pos.x, z: pos.z };
  }
}

/** Check if a trail point is on the given wall surface */
function isTrailPointOnWall(pt: { x: number; y: number; z: number }, surfaceType: SurfaceType): boolean {
  const margin = 1.5;
  switch (surfaceType) {
    case SurfaceType.WallXPos: return pt.x >= ARENA_HALF - margin && pt.y > 0.5;
    case SurfaceType.WallXNeg: return pt.x <= -ARENA_HALF + margin && pt.y > 0.5;
    case SurfaceType.WallZPos: return pt.z >= ARENA_HALF - margin && pt.y > 0.5;
    case SurfaceType.WallZNeg: return pt.z <= -ARENA_HALF + margin && pt.y > 0.5;
    default: return false;
  }
}

/**
 * Check trail collision for a bike on a wall.
 * Projects positions and trail points to 2D in the wall plane.
 */
export function checkTrailCollisionOnWall(
  oldPos3D: Vec3,
  newPos3D: Vec3,
  surfaceType: SurfaceType,
  trails: SimTrail[],
  ownTrailIndex: number,
): TrailHitInfo | null {
  const oldPos2D = projectToWallPlane(oldPos3D, surfaceType);
  const newPos2D = projectToWallPlane(newPos3D, surfaceType);

  for (let t = 0; t < trails.length; t++) {
    const trail = trails[t];
    const pts = trail.points;
    const skipEnd = t === ownTrailIndex ? TRAIL_SKIP_SEGMENTS : 0;
    const endIdx = pts.length - 1 - skipEnd;

    for (let i = 0; i < endIdx; i++) {
      if (isNaN(pts[i].x) || isNaN(pts[i + 1].x)) continue;

      // Only test trail segments that are on the same wall
      if (!isTrailPointOnWall(pts[i], surfaceType) && !isTrailPointOnWall(pts[i + 1], surfaceType)) continue;

      const seg1 = projectToWallPlane(pts[i] as Vec3, surfaceType);
      const seg2 = projectToWallPlane(pts[i + 1] as Vec3, surfaceType);

      if (lineSegmentsIntersect(oldPos2D, newPos2D, seg1, seg2)) {
        return { trailIndex: t, contactX: pts[i].x, contactZ: pts[i].z };
      }
    }
  }
  return null;
}
