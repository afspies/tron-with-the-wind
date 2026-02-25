import { describe, it, expect } from 'vitest';
import { SimTrail } from '@tron/game-core';

describe('SimTrail', () => {
  describe('deleteSegmentsInRadius with NaN gap markers', () => {
    it('inserts NaN gap between surviving groups', () => {
      const trail = new SimTrail();
      trail.points = [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 15, y: 0, z: 0 },
      ];

      trail.deleteSegmentsInRadius(5, 0, 3);

      // Point at x=5 removed, gap marker inserted between x=0 and x=10
      const real = trail.points.filter(p => !isNaN(p.x));
      expect(real).toHaveLength(3);
      expect(real.map(p => p.x)).toEqual([0, 10, 15]);

      // One NaN gap marker
      const gaps = trail.points.filter(p => isNaN(p.x));
      expect(gaps).toHaveLength(1);

      // Order: [0, NaN, 10, 15]
      expect(trail.points[0].x).toBe(0);
      expect(isNaN(trail.points[1].x)).toBe(true);
      expect(trail.points[2].x).toBe(10);
      expect(trail.points[3].x).toBe(15);
    });

    it('removes multiple consecutive points with single gap', () => {
      const trail = new SimTrail();
      trail.points = [
        { x: -20, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 7, y: 0, z: 0 },
        { x: 20, y: 0, z: 0 },
      ];

      // Radius 5 centered at (5,0) removes x=3, x=5, x=7 (all within distance 5)
      trail.deleteSegmentsInRadius(5, 0, 5);

      const real = trail.points.filter(p => !isNaN(p.x));
      expect(real).toHaveLength(2);
      expect(real.map(p => p.x)).toEqual([-20, 20]);

      // Only one gap between the two surviving groups
      const gaps = trail.points.filter(p => isNaN(p.x));
      expect(gaps).toHaveLength(1);
    });

    it('no gap marker when deletion is at the start', () => {
      const trail = new SimTrail();
      trail.points = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 15, y: 0, z: 0 },
      ];

      // Remove first two points
      trail.deleteSegmentsInRadius(0.5, 0, 2);

      const real = trail.points.filter(p => !isNaN(p.x));
      expect(real).toHaveLength(2);
      // No gap marker since there's nothing before the surviving group
      expect(trail.points.filter(p => isNaN(p.x))).toHaveLength(0);
    });

    it('no gap marker when deletion is at the end', () => {
      const trail = new SimTrail();
      trail.points = [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 14, y: 0, z: 0 },
        { x: 15, y: 0, z: 0 },
      ];

      // Remove last two points
      trail.deleteSegmentsInRadius(14.5, 0, 2);

      const real = trail.points.filter(p => !isNaN(p.x));
      expect(real).toHaveLength(2);
      expect(trail.points.filter(p => isNaN(p.x))).toHaveLength(0);
    });

    it('preserves existing NaN gap markers', () => {
      const trail = new SimTrail();
      trail.points = [
        { x: 0, y: 0, z: 0 },
        { x: NaN, y: NaN, z: NaN },
        { x: 10, y: 0, z: 0 },
        { x: 15, y: 0, z: 0 },
        { x: 20, y: 0, z: 0 },
      ];

      // Remove point at x=15
      trail.deleteSegmentsInRadius(15, 0, 3);

      const gaps = trail.points.filter(p => isNaN(p.x));
      // Original gap + new gap from removing x=15
      expect(gaps).toHaveLength(2);

      const real = trail.points.filter(p => !isNaN(p.x));
      expect(real.map(p => p.x)).toEqual([0, 10, 20]);
    });

    it('handles removing all points', () => {
      const trail = new SimTrail();
      trail.points = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ];

      trail.deleteSegmentsInRadius(1, 0, 10);

      expect(trail.points).toHaveLength(0);
    });

    it('no-ops when nothing is in radius', () => {
      const trail = new SimTrail();
      trail.points = [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ];

      trail.deleteSegmentsInRadius(100, 100, 3);

      expect(trail.points).toHaveLength(2);
      expect(trail.points.filter(p => isNaN(p.x))).toHaveLength(0);
    });
  });
});
