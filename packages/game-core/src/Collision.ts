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

export interface NearMissInfo {
  trailIndex: number;
  distance: number;
  x: number;
  z: number;
}

function pointToSegmentDistSq(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
): { distSq: number; closestX: number; closestZ: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-10) return { distSq: (px - ax) ** 2 + (pz - az) ** 2, closestX: ax, closestZ: az };
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = ax + t * dx;
  const closestZ = az + t * dz;
  const distSq = (px - closestX) ** 2 + (pz - closestZ) ** 2;
  return { distSq, closestX, closestZ };
}

export function checkNearMiss(
  bikeX: number, bikeZ: number, bikeY: number,
  trails: SimTrail[],
  ownIndex: number,
  threshold: number,
): NearMissInfo | null {
  const thresholdSq = threshold * threshold;
  let closest: NearMissInfo | null = null;
  let closestDistSq = thresholdSq;

  for (let t = 0; t < trails.length; t++) {
    if (t === ownIndex) continue;
    const pts = trails[t].points;
    for (let i = 0; i < pts.length - 1; i++) {
      if (isNaN(pts[i].x) || isNaN(pts[i + 1].x)) continue;
      // Height check: only count if Y ranges overlap
      const segMinY = Math.min(pts[i].y, pts[i + 1].y);
      const segMaxY = Math.max(pts[i].y, pts[i + 1].y) + TRAIL_HEIGHT;
      if (bikeY > segMaxY + BIKE_COLLISION_HEIGHT || bikeY + BIKE_COLLISION_HEIGHT < segMinY) continue;

      const { distSq, closestX, closestZ } = pointToSegmentDistSq(
        bikeX, bikeZ, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z,
      );
      if (distSq < closestDistSq) {
        closestDistSq = distSq;
        closest = { trailIndex: t, distance: Math.sqrt(distSq), x: closestX, z: closestZ };
      }
    }
  }
  return closest;
}
