import { describe, it, expect } from 'vitest';
import { rotateVectorAroundAxis, projectOntoSurfacePlane } from '../Surface.js';
import { vec3, length } from './helpers.js';

describe('rotateVectorAroundAxis', () => {
  it('rotates (1,0,0) around Y by π/2 → (0,0,-1)', () => {
    const result = rotateVectorAroundAxis(vec3(1, 0, 0), vec3(0, 1, 0), Math.PI / 2);
    expect(result.x).toBeCloseTo(0, 5);
    expect(result.y).toBeCloseTo(0, 5);
    expect(result.z).toBeCloseTo(-1, 5);
  });

  it('rotates (0,0,1) around (-1,0,0) by π/2 → (0,1,0) — wall steering rotation', () => {
    const result = rotateVectorAroundAxis(vec3(0, 0, 1), vec3(-1, 0, 0), Math.PI / 2);
    expect(result.x).toBeCloseTo(0, 5);
    expect(result.y).toBeCloseTo(1, 5);
    expect(result.z).toBeCloseTo(0, 5);
  });

  it('rotation by 0 is identity', () => {
    const v = vec3(3, 4, 5);
    const result = rotateVectorAroundAxis(v, vec3(0, 1, 0), 0);
    expect(result.x).toBeCloseTo(v.x, 5);
    expect(result.y).toBeCloseTo(v.y, 5);
    expect(result.z).toBeCloseTo(v.z, 5);
  });

  it('rotation by 2π is identity', () => {
    const v = vec3(1, 2, 3);
    const result = rotateVectorAroundAxis(v, vec3(0, 0, 1), Math.PI * 2);
    expect(result.x).toBeCloseTo(v.x, 4);
    expect(result.y).toBeCloseTo(v.y, 4);
    expect(result.z).toBeCloseTo(v.z, 4);
  });
});

describe('projectOntoSurfacePlane', () => {
  it('projects (1,1,0) onto plane normal=(0,1,0) → normalized (1,0,0)', () => {
    const result = projectOntoSurfacePlane(vec3(1, 1, 0), vec3(0, 1, 0));
    expect(result.x).toBeCloseTo(1, 5);
    expect(result.y).toBeCloseTo(0, 5);
    expect(result.z).toBeCloseTo(0, 5);
  });

  it('projects vector parallel to normal → zero vector', () => {
    const result = projectOntoSurfacePlane(vec3(0, 5, 0), vec3(0, 1, 0));
    expect(length(result)).toBeCloseTo(0, 3);
  });

  it('vector already in plane stays the same direction', () => {
    const result = projectOntoSurfacePlane(vec3(3, 0, 4), vec3(0, 1, 0));
    // Should be normalized (3/5, 0, 4/5)
    expect(result.x).toBeCloseTo(3 / 5, 5);
    expect(result.y).toBeCloseTo(0, 5);
    expect(result.z).toBeCloseTo(4 / 5, 5);
  });
});
