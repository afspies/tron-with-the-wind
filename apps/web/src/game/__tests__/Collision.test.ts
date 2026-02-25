import { describe, it, expect } from 'vitest';
import { SimTrail, checkTrailCollision, checkTrailCollisionDetailed } from '@tron/game-core';

describe('Collision with NaN gap markers', () => {
  it('skips NaN gap segments in collision detection', () => {
    const trail = new SimTrail();
    // Two segments with a gap between them: [A, NaN, B, C]
    // Without NaN handling, A→NaN and NaN→B would be checked as segments
    trail.points = [
      { x: -10, y: 0, z: 0 },
      { x: NaN, y: NaN, z: NaN },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 0, z: 20 },
    ];

    // Movement that crosses the gap (from x=-5 to x=5) should NOT collide
    // because the NaN gap means there's no real segment between x=-10 and x=10
    const hit = checkTrailCollision(
      { x: 0, z: -5 },
      { x: 0, z: 5 },
      0,
      [trail],
      -1, // not own trail
    );
    expect(hit).toBe(false);
  });

  it('still detects collision on real segments after a gap', () => {
    const trail = new SimTrail();
    // [A, NaN, B, C] — segment B→C is real and should collide
    trail.points = [
      { x: -10, y: 0, z: 0 },
      { x: NaN, y: NaN, z: NaN },
      { x: -5, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ];

    // Movement that crosses segment B→C (from z=-5 to z=5 at x=0)
    const hit = checkTrailCollision(
      { x: 0, z: -5 },
      { x: 0, z: 5 },
      0,
      [trail],
      -1,
    );
    expect(hit).toBe(true);
  });

  it('checkTrailCollisionDetailed returns correct contact for real segments', () => {
    const trail = new SimTrail();
    trail.points = [
      { x: -5, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ];

    const hit = checkTrailCollisionDetailed(
      { x: 0, z: -5 },
      { x: 0, z: 5 },
      0,
      [trail],
      -1,
    );
    expect(hit).not.toBeNull();
    expect(hit!.trailIndex).toBe(0);
    // Contact should be near x=0, z=0
    expect(Math.abs(hit!.contactX)).toBeLessThan(0.1);
    expect(Math.abs(hit!.contactZ)).toBeLessThan(0.1);
  });

  it('no collision when all segments are NaN gaps', () => {
    const trail = new SimTrail();
    trail.points = [
      { x: NaN, y: NaN, z: NaN },
      { x: NaN, y: NaN, z: NaN },
      { x: NaN, y: NaN, z: NaN },
    ];

    const hit = checkTrailCollision(
      { x: 0, z: -5 },
      { x: 0, z: 5 },
      0,
      [trail],
      -1,
    );
    expect(hit).toBe(false);
  });

  it('handles trail with gaps from deleteSegmentsInRadius', () => {
    const trail = new SimTrail();
    // Build a trail that crosses z=0 from x=-10 to x=10
    trail.points = [
      { x: -10, y: 0, z: 0 },
      { x: -5, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ];

    // Delete the middle section — creates gaps
    trail.deleteSegmentsInRadius(0, 0, 3);

    // Movement along z axis at x=0 should NOT collide (the middle is gone)
    const hit = checkTrailCollision(
      { x: 0, z: -5 },
      { x: 0, z: 5 },
      0,
      [trail],
      -1,
    );
    expect(hit).toBe(false);

    // But movement at x=-7 (crossing the left surviving segment) should collide
    const hit2 = checkTrailCollision(
      { x: -7, z: -5 },
      { x: -7, z: 5 },
      0,
      [trail],
      -1,
    );
    expect(hit2).toBe(true);
  });
});
