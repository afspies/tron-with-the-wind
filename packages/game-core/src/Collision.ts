import type { Vec2 } from '@tron/shared';
import { ARENA_HALF, TRAIL_HEIGHT, TRAIL_SKIP_SEGMENTS, BIKE_COLLISION_HEIGHT } from '@tron/shared';
import type { SimTrail } from './SimTrail';

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
  for (let t = 0; t < trails.length; t++) {
    const trail = trails[t];
    const pts = trail.points;
    const skipEnd = t === ownTrailIndex ? TRAIL_SKIP_SEGMENTS : 0;
    const endIdx = pts.length - 1 - skipEnd;

    for (let i = 0; i < endIdx; i++) {
      if (isNaN(pts[i].x) || isNaN(pts[i + 1].x)) continue;
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
