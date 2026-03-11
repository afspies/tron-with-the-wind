import { describe, it, expect } from 'vitest';
import { SurfaceType, ARENA_HALF } from '@tron/shared';
import { checkTrailCollisionOnWall, checkWallCollision } from '../Collision.js';
import { SimTrail } from '../SimTrail.js';
import { vec3 } from './helpers.js';

describe('checkTrailCollisionOnWall', () => {
  it('WallXPos: trail on +X wall, bike crosses in (z,y) plane → hit', () => {
    const trail = new SimTrail();
    trail.addPoint(ARENA_HALF, 5, 0);
    trail.addPoint(ARENA_HALF, 25, 0);

    const oldPos = vec3(ARENA_HALF, 15, -2);
    const newPos = vec3(ARENA_HALF, 15, 2);

    const hit = checkTrailCollisionOnWall(oldPos, newPos, SurfaceType.WallXPos, [trail], -1);
    expect(hit).not.toBeNull();
  });

  it('same wall, trail on floor → no hit (wrong surface)', () => {
    const trail = new SimTrail();
    trail.addPoint(0, 0, -5);
    trail.addPoint(0, 0, 5);

    const oldPos = vec3(ARENA_HALF, 15, -2);
    const newPos = vec3(ARENA_HALF, 15, 2);

    const hit = checkTrailCollisionOnWall(oldPos, newPos, SurfaceType.WallXPos, [trail], -1);
    expect(hit).toBeNull();
  });
});

describe('checkWallCollision', () => {
  it('returns true when |x| > ARENA_HALF', () => {
    expect(checkWallCollision(ARENA_HALF + 1, 0)).toBe(true);
    expect(checkWallCollision(-(ARENA_HALF + 1), 0)).toBe(true);
  });

  it('returns true when |z| > ARENA_HALF', () => {
    expect(checkWallCollision(0, ARENA_HALF + 1)).toBe(true);
    expect(checkWallCollision(0, -(ARENA_HALF + 1))).toBe(true);
  });

  it('returns false when inside arena', () => {
    expect(checkWallCollision(0, 0)).toBe(false);
    expect(checkWallCollision(ARENA_HALF - 1, ARENA_HALF - 1)).toBe(false);
  });
});
