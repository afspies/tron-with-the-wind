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

describe('Self-trail grace radius', () => {
  it('ignores vertically stacked own-trail segments within grace radius', () => {
    const trail = new SimTrail();
    // Simulate steep pitch: trail segments at nearly the same XZ but different Y
    // Bike is at (0, 10, 0), trail segments are directly below at (0, 0..8, 0)
    trail.points = [
      { x: -0.5, y: 0, z: 0 },
      { x: 0.5, y: 2, z: 0 },
      { x: 1.0, y: 4, z: 0 },
      { x: 0.8, y: 6, z: 0 },
      { x: 0.3, y: 8, z: 0 },
      // these last points are within TRAIL_SKIP_SEGMENTS and will be skipped anyway
      { x: 0.1, y: 9, z: 0 },
      { x: 0.0, y: 9.5, z: 0 },
      { x: 0.0, y: 10, z: 0 },
    ];

    // Bike moves from (0, -1) to (0, 1) at y=10 — crosses the trail segments in XZ
    // but all segment endpoints are within 4.0 XZ of newPos (0, 1)
    const hit = checkTrailCollision(
      { x: 0, z: -1 },
      { x: 0, z: 1 },
      0, // bikeY at ground level — overlaps trail vertically
      [trail],
      0, // own trail
    );
    expect(hit).toBe(false);
  });

  it('still detects distant own-trail collision', () => {
    const trail = new SimTrail();
    // Trail far from bike in XZ — like a U-turn scenario
    trail.points = [
      { x: -10, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      // padding for TRAIL_SKIP_SEGMENTS
      { x: 20, y: 0, z: 0 },
      { x: 30, y: 0, z: 0 },
      { x: 40, y: 0, z: 0 },
      { x: 50, y: 0, z: 0 },
    ];

    // Bike crosses the first segment at x=0 — endpoints at (-10,0) and (10,0)
    // are well beyond grace radius of 4.0 from newPos (0,5)
    const hit = checkTrailCollision(
      { x: 0, z: -5 },
      { x: 0, z: 5 },
      0,
      [trail],
      0, // own trail
    );
    expect(hit).toBe(true);
  });

  it('still detects other player trail within grace radius', () => {
    const ownTrail = new SimTrail();
    ownTrail.points = [];

    const otherTrail = new SimTrail();
    // Other player's trail is close in XZ — grace radius should NOT apply
    otherTrail.points = [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ];

    // Bike crosses the trail — both endpoints within grace radius of newPos
    const hit = checkTrailCollision(
      { x: 0, z: -5 },
      { x: 0, z: 5 },
      0,
      [ownTrail, otherTrail],
      0, // trail index 0 is own, index 1 is other
    );
    expect(hit).toBe(true);
  });
});
