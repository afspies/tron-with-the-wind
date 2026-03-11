import { describe, it, expect } from 'vitest';
import { SurfaceType, ARENA_HALF, CEILING_HEIGHT } from '@tron/shared';
import { getArenaSurfaceInfo, deriveSurfaceType, getGravityTangent } from '../ArenaSurface.js';
import { vec3, length } from './helpers.js';

describe('getArenaSurfaceInfo', () => {
  it('floor center returns normal=(0,1,0) and Floor type', () => {
    const info = getArenaSurfaceInfo(vec3(0, 0, 0));
    expect(info.normal.x).toBeCloseTo(0);
    expect(info.normal.y).toBeCloseTo(1);
    expect(info.normal.z).toBeCloseTo(0);
    expect(info.surfaceType).toBe(SurfaceType.Floor);
  });

  it('+X wall face: inward normal has negative x component', () => {
    const info = getArenaSurfaceInfo(vec3(ARENA_HALF, 30, 0));
    expect(info.normal.x).toBeLessThan(-0.5);
    expect(info.surfaceType).toBe(SurfaceType.WallXPos);
  });

  it('-X wall face: inward normal has positive x component', () => {
    const info = getArenaSurfaceInfo(vec3(-ARENA_HALF, 30, 0));
    expect(info.normal.x).toBeGreaterThan(0.5);
    expect(info.surfaceType).toBe(SurfaceType.WallXNeg);
  });

  it('+Z wall face: inward normal has negative z component', () => {
    const info = getArenaSurfaceInfo(vec3(0, 30, ARENA_HALF));
    expect(info.normal.z).toBeLessThan(-0.5);
    expect(info.surfaceType).toBe(SurfaceType.WallZPos);
  });

  it('-Z wall face: inward normal has positive z component', () => {
    const info = getArenaSurfaceInfo(vec3(0, 30, -ARENA_HALF));
    expect(info.normal.z).toBeGreaterThan(0.5);
    expect(info.surfaceType).toBe(SurfaceType.WallZNeg);
  });

  it('constrains position outside arena back to surface', () => {
    const info = getArenaSurfaceInfo(vec3(ARENA_HALF + 10, 0, 0));
    expect(info.constrainedPos.x).toBeLessThanOrEqual(ARENA_HALF + 0.01);
  });

  it('floor-wall ramp zone has blended normal', () => {
    const info = getArenaSurfaceInfo(vec3(ARENA_HALF - 4, 2, 0));
    expect(Math.abs(info.normal.y)).toBeGreaterThan(0.01);
    expect(Math.abs(info.normal.x)).toBeGreaterThan(0.01);
  });
});

describe('deriveSurfaceType', () => {
  it('normal.y > 0.7 → Floor', () => {
    expect(deriveSurfaceType(vec3(0, 1, 0))).toBe(SurfaceType.Floor);
    expect(deriveSurfaceType(vec3(0.3, 0.8, 0))).toBe(SurfaceType.Floor);
  });

  it('normal.y < -0.7 → Air (ceiling)', () => {
    expect(deriveSurfaceType(vec3(0, -1, 0))).toBe(SurfaceType.Air);
  });

  it('wall-like normals map to correct wall type', () => {
    expect(deriveSurfaceType(vec3(-1, 0, 0))).toBe(SurfaceType.WallXPos);
    expect(deriveSurfaceType(vec3(1, 0, 0))).toBe(SurfaceType.WallXNeg);
    expect(deriveSurfaceType(vec3(0, 0, -1))).toBe(SurfaceType.WallZPos);
    expect(deriveSurfaceType(vec3(0, 0, 1))).toBe(SurfaceType.WallZNeg);
  });
});

describe('getGravityTangent', () => {
  it('zero on floor (normal.y=1)', () => {
    const g = getGravityTangent(vec3(0, 1, 0));
    expect(length(g)).toBeCloseTo(0, 3);
  });

  it('downward component on wall (normal=(-1,0,0))', () => {
    const g = getGravityTangent(vec3(-1, 0, 0));
    expect(g.y).toBeLessThan(0);
    expect(g.x).toBeCloseTo(0, 3);
  });
});
