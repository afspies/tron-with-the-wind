import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock THREE.js to avoid WebGL dependency
vi.mock('three', () => {
  class MockBufferGeometry {
    attributes: Record<string, { array: Float32Array; needsUpdate: boolean }> = {};
    setAttribute(name: string, attr: { array: Float32Array }) {
      this.attributes[name] = { array: attr.array, needsUpdate: false };
    }
    setDrawRange() {}
    dispose() {}
  }

  class MockBufferAttribute {
    array: Float32Array;
    itemSize: number;
    constructor(arr: Float32Array, size: number) {
      this.array = arr;
      this.itemSize = size;
    }
  }

  class MockMeshStandardMaterial {
    dispose() {}
  }

  class MockMesh {
    frustumCulled = true;
    geometry: MockBufferGeometry;
    constructor(geo: MockBufferGeometry) {
      this.geometry = geo;
    }
  }

  class MockColor {}

  return {
    BufferGeometry: MockBufferGeometry,
    BufferAttribute: MockBufferAttribute,
    MeshStandardMaterial: MockMeshStandardMaterial,
    Mesh: MockMesh,
    Color: MockColor,
    DoubleSide: 2,
  };
});

import { Trail } from '../Trail';
import * as THREE from 'three';

describe('Trail', () => {
  let trail: Trail;
  const mockScene = { add: vi.fn(), remove: vi.fn() } as unknown as THREE.Scene;

  beforeEach(() => {
    vi.clearAllMocks();
    trail = new Trail('#ff0000', mockScene);
  });

  it('starts with empty points', () => {
    expect(trail.points).toHaveLength(0);
  });

  it('addPoint adds to points array', () => {
    trail.addPoint(0, 0, 0);
    expect(trail.points).toHaveLength(1);
    expect(trail.points[0]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('addPoint skips points too close together', () => {
    trail.addPoint(0, 0, 0);
    trail.addPoint(0.1, 0, 0.1); // too close (< TRAIL_SAMPLE_DISTANCE=1.0)
    expect(trail.points).toHaveLength(1);
  });

  it('addPoint accepts points far enough apart', () => {
    trail.addPoint(0, 0, 0);
    trail.addPoint(2, 0, 0); // far enough
    expect(trail.points).toHaveLength(2);
  });

  it('reset clears all points', () => {
    trail.addPoint(0, 0, 0);
    trail.addPoint(2, 0, 0);
    trail.reset();
    expect(trail.points).toHaveLength(0);
  });

  it('deleteSegmentsInRadius removes points within radius and inserts NaN gap', () => {
    trail.points = [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 15, y: 0, z: 0 },
    ];

    const removed = trail.deleteSegmentsInRadius(5, 0, 3);
    expect(removed).toBe(1);
    // 3 surviving points + 1 NaN gap marker = 4
    expect(trail.points).toHaveLength(4);
    expect(trail.points.filter(p => !isNaN(p.x)).every(p => p.x !== 5)).toBe(true);
    // Gap marker should be between first point and second surviving group
    expect(isNaN(trail.points[1].x)).toBe(true);
  });

  it('deleteSegmentsInRadius returns 0 when nothing in radius', () => {
    trail.points = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ];
    const removed = trail.deleteSegmentsInRadius(100, 100, 3);
    expect(removed).toBe(0);
  });

  it('addPoints appends multiple points at once', () => {
    trail.points = [{ x: 0, y: 0, z: 0 }];
    trail.addPoints([
      { x: 2, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ]);
    expect(trail.points).toHaveLength(3);
  });

  it('replaceAll replaces all points', () => {
    trail.points = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ];
    trail.replaceAll([
      { x: 10, y: 0, z: 10 },
      { x: 20, y: 0, z: 20 },
      { x: 30, y: 0, z: 30 },
    ]);
    expect(trail.points).toHaveLength(3);
    expect(trail.points[0].x).toBe(10);
  });
});
