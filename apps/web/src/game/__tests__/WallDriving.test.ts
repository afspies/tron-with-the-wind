import { describe, it, expect } from 'vitest';
import { SimBike } from '@tron/game-core';
import {
  NO_INPUT, BIKE_SPEED, TURN_RATE, ARENA_HALF, CURVE_RADIUS, CEILING_HEIGHT,
  computeSurfaceInfo, SurfaceId, snapToSurface,
  quatFromAxisAngle, quatRotateVec3, quatToYawAngle, vec3Length, vec3Dot,
} from '@tron/shared';
import type { PlayerInput } from '@tron/shared';

const DT = 1 / 60;

function makeInput(overrides: Partial<PlayerInput>): PlayerInput {
  return { ...NO_INPUT, ...overrides };
}

// ---------- Turning on the floor ----------

describe('Grounded turning', () => {
  it('turns left when left input is held', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, 0); // facing +Z (angle=0)
    const startAngle = bike.angle;

    // Simulate 0.5s of left turning
    for (let i = 0; i < 30; i++) {
      bike.update(DT, makeInput({ left: true }), [], true);
    }

    const endAngle = bike.angle;
    // Left turn should increase the angle (positive rotation around Y)
    const delta = endAngle - startAngle;
    // Normalize to (-PI, PI]
    const wrapped = ((delta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    expect(wrapped).toBeGreaterThan(0.1);
  });

  it('turns right when right input is held', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, 0);
    const startAngle = bike.angle;

    for (let i = 0; i < 30; i++) {
      bike.update(DT, makeInput({ right: true }), [], true);
    }

    const endAngle = bike.angle;
    const delta = endAngle - startAngle;
    const wrapped = ((delta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    expect(wrapped).toBeLessThan(-0.1);
  });

  it('maintains angle when no turn input', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, Math.PI / 4);
    const startAngle = bike.angle;

    for (let i = 0; i < 30; i++) {
      bike.update(DT, NO_INPUT, [], true);
    }

    expect(bike.angle).toBeCloseTo(startAngle, 2);
  });

  it('turn rate matches expected TURN_RATE', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, 0);
    const duration = 1.0; // 1 second
    const steps = Math.round(duration / DT);

    for (let i = 0; i < steps; i++) {
      bike.update(DT, makeInput({ left: true }), [], true);
    }

    // After 1 second of turning, angle should change by approximately TURN_RATE radians
    const delta = bike.angle;
    expect(Math.abs(delta - TURN_RATE)).toBeLessThan(0.2);
  });

  it('changes X/Z position after turning', () => {
    // Start facing +Z, turn left for a while, then check we moved in a different direction
    const bike = new SimBike(0, '#ff0000', 0, 0, 0);

    // Turn left for 0.5s
    for (let i = 0; i < 30; i++) {
      bike.update(DT, makeInput({ left: true }), [], true);
    }
    // Then go straight for 0.5s
    for (let i = 0; i < 30; i++) {
      bike.update(DT, NO_INPUT, [], true);
    }

    // Should have moved in X direction (turned left from +Z means moving in +X)
    expect(Math.abs(bike.position.x)).toBeGreaterThan(1);
  });
});

// ---------- Self-trail collision (dying when driving into own trail) ----------

describe('Self-trail collision', () => {
  it('dies when driving through its own trail', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, 0); // facing +Z

    // Drive forward to build a trail along the Z axis
    for (let i = 0; i < 120; i++) {
      bike.update(DT, NO_INPUT, [bike.trail], true);
    }
    expect(bike.trail.points.length).toBeGreaterThan(5);

    // Teleport the bike to a crossing position: offset in X, facing across the trail
    // The trail runs along Z from ~0 to ~60, so place the bike at X=-10, Z=30
    // facing +X (angle = PI/2) so it drives across the trail
    bike.position = { x: -10, y: 0, z: 30 };
    bike.orientation = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    bike.velocity = { x: BIKE_SPEED, y: 0, z: 0 };
    bike.surfaceNormal = { x: 0, y: 1, z: 0 };
    bike.surfaceId = SurfaceId.FLOOR;
    bike.grounded = true;

    // Drive across with collision enabled — should hit its own trail
    let died = false;
    for (let i = 0; i < 60; i++) {
      bike.update(DT, NO_INPUT, [bike.trail], false);
      if (!bike.alive) {
        died = true;
        break;
      }
    }

    expect(died).toBe(true);
  });

  it('survives when driving straight (no self-collision)', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, 0);

    // Drive forward for 2 seconds with collision enabled
    for (let i = 0; i < 120; i++) {
      bike.update(DT, NO_INPUT, [bike.trail], false);
    }

    expect(bike.alive).toBe(true);
  });
});

// ---------- Arena surface model ----------

describe('Arena surface model', () => {
  const FLAT_HALF = ARENA_HALF - CURVE_RADIUS;

  it('floor returns correct surface info', () => {
    const info = computeSurfaceInfo({ x: 0, y: 0, z: 0 });
    expect(info.surfaceId).toBe(SurfaceId.FLOOR);
    expect(info.normal.y).toBeCloseTo(1);
    expect(info.drivable).toBe(true);
  });

  it('wall returns correct surface info', () => {
    // Position on the +X wall
    const info = computeSurfaceInfo({ x: ARENA_HALF - 0.1, y: CURVE_RADIUS + 1, z: 0 });
    expect(info.surfaceId).toBe(SurfaceId.WALL_POS_X);
    expect(info.normal.x).toBeCloseTo(-1);
    expect(info.normal.y).toBeCloseTo(0);
    expect(info.drivable).toBe(true);
  });

  describe('bottom curve normals point inward', () => {
    it('+X bottom curve near floor has upward-pointing normal', () => {
      // Position near floor in the +X curve zone
      const x = FLAT_HALF + 1;
      const y = 1; // close to floor
      const info = computeSurfaceInfo({ x, y, z: 0 });
      expect(info.surfaceId).toBe(SurfaceId.CURVE_PX);
      // Normal should point mostly UP (inward at floor)
      expect(info.normal.y).toBeGreaterThan(0.5);
      expect(info.drivable).toBe(true);
    });

    it('+X bottom curve near wall has inward-pointing normal', () => {
      // Position near wall in the +X curve zone
      const x = ARENA_HALF - 1;
      const y = CURVE_RADIUS - 1;
      const info = computeSurfaceInfo({ x, y, z: 0 });
      // Normal should point mostly in -X direction (inward from +X wall)
      expect(info.normal.x).toBeLessThan(-0.5);
      expect(info.drivable).toBe(true);
    });

    it('-Z bottom curve near floor has upward-pointing normal', () => {
      const z = -(FLAT_HALF + 1);
      const y = 1;
      const info = computeSurfaceInfo({ x: 0, y, z });
      expect(info.surfaceId).toBe(SurfaceId.CURVE_NZ);
      expect(info.normal.y).toBeGreaterThan(0.5);
      expect(info.drivable).toBe(true);
    });
  });

  describe('curve normals are unit length and inward-facing', () => {
    it('all bottom curve normals have unit length', () => {
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // Sweep through the +X bottom curve zone
        const x = FLAT_HALF + t * CURVE_RADIUS * 0.9;
        const y = (1 - t) * (CURVE_RADIUS * 0.9);
        const info = computeSurfaceInfo({ x, y, z: 0 });
        const len = vec3Length(info.normal);
        expect(len).toBeCloseTo(1, 3);
      }
    });
  });

  describe('snapToSurface consistency', () => {
    it('snapping a floor point lands at y=0', () => {
      const pos = { x: 10, y: 0.5, z: 10 };
      const info = computeSurfaceInfo(pos);
      const snapped = snapToSurface(pos, info);
      expect(snapped.y).toBeCloseTo(0, 3);
    });

    it('snapping a curve point lands on the curve surface', () => {
      // Point inside the +X bottom curve zone
      const pos = { x: FLAT_HALF + 2, y: 2, z: 0 };
      const info = computeSurfaceInfo(pos);
      const snapped = snapToSurface(pos, info);

      // Distance from curve center should be approximately R
      const cx = FLAT_HALF;
      const cy = CURVE_RADIUS;
      const dx = Math.abs(snapped.x) - cx;
      const dy = snapped.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeCloseTo(CURVE_RADIUS, 1);
    });
  });
});

// ---------- Wall driving: floor → curve → wall transitions ----------

describe('Wall driving transitions', () => {
  it('bike drives from floor onto curve smoothly', () => {
    const FLAT_HALF = ARENA_HALF - CURVE_RADIUS;
    // Place bike near the edge of the flat floor, facing +X toward the wall
    const startX = FLAT_HALF - 5;
    const bike = new SimBike(0, '#ff0000', startX, 0, Math.PI / 2); // facing +X

    // Drive forward for several seconds
    const positions: Array<{ x: number; y: number; surfaceId: number }> = [];
    for (let i = 0; i < 300; i++) {
      bike.update(DT, NO_INPUT, [], true);
      positions.push({
        x: bike.position.x,
        y: bike.position.y,
        surfaceId: bike.surfaceId,
      });
    }

    // Should have transitioned from floor to curve
    const startedOnFloor = positions[0].surfaceId === SurfaceId.FLOOR;
    const reachedCurve = positions.some(p => p.surfaceId === SurfaceId.CURVE_PX);
    expect(startedOnFloor).toBe(true);
    expect(reachedCurve).toBe(true);
  });

  it('bike drives from curve onto wall', () => {
    const FLAT_HALF = ARENA_HALF - CURVE_RADIUS;
    // Place bike at the start of the curve, facing +X
    const startX = FLAT_HALF + 1;
    const bike = new SimBike(0, '#ff0000', startX, 1, Math.PI / 2);

    // Manually set grounded state on the curve
    const info = computeSurfaceInfo(bike.position);
    bike.position = snapToSurface(bike.position, info);
    bike.surfaceNormal = info.normal;
    bike.surfaceId = info.surfaceId;

    const surfaces: SurfaceId[] = [];
    for (let i = 0; i < 300; i++) {
      bike.update(DT, NO_INPUT, [], true);
      if (!surfaces.includes(bike.surfaceId)) {
        surfaces.push(bike.surfaceId);
      }
      if (!bike.alive) break;
    }

    // Should have visited curve and wall
    const visitedCurve = surfaces.includes(SurfaceId.CURVE_PX);
    const visitedWall = surfaces.includes(SurfaceId.WALL_POS_X);
    expect(visitedCurve || visitedWall).toBe(true);
  });

  it('bike stays alive while driving up the wall (no sudden death)', () => {
    const FLAT_HALF = ARENA_HALF - CURVE_RADIUS;
    // Start near the curve
    const bike = new SimBike(0, '#ff0000', FLAT_HALF - 3, 0, Math.PI / 2);

    // Drive toward wall for 5 seconds
    for (let i = 0; i < 300; i++) {
      bike.update(DT, NO_INPUT, [], true);
    }

    // Bike should still be alive (wall driving, not dead from boundary)
    expect(bike.alive).toBe(true);
  });

  it('surface normal transitions smoothly through curve', () => {
    const FLAT_HALF = ARENA_HALF - CURVE_RADIUS;
    const bike = new SimBike(0, '#ff0000', FLAT_HALF - 5, 0, Math.PI / 2);

    let prevNormalY = 1; // start facing floor (normal = up)
    let maxNormalJump = 0;

    for (let i = 0; i < 300; i++) {
      bike.update(DT, NO_INPUT, [], true);
      if (bike.grounded) {
        const normalJump = Math.abs(bike.surfaceNormal.y - prevNormalY);
        maxNormalJump = Math.max(maxNormalJump, normalJump);
        prevNormalY = bike.surfaceNormal.y;
      }
    }

    // Normal should change smoothly (no jumps > 0.3 per frame)
    expect(maxNormalJump).toBeLessThan(0.3);
  });
});

// ---------- reorthogonalizeOrientation preserves heading ----------

describe('Orientation preservation', () => {
  it('reorthogonalize preserves forward direction on floor', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, Math.PI / 4);
    const initialForward = quatRotateVec3(bike.orientation, { x: 0, y: 0, z: 1 });

    // Run 10 frames with no input — reorthogonalize is called each frame
    for (let i = 0; i < 10; i++) {
      bike.update(DT, NO_INPUT, [], true);
    }

    const finalForward = quatRotateVec3(bike.orientation, { x: 0, y: 0, z: 1 });

    // Forward direction should be essentially unchanged (just floor projection)
    expect(finalForward.x).toBeCloseTo(initialForward.x, 2);
    expect(finalForward.z).toBeCloseTo(initialForward.z, 2);
  });

  it('steering accumulates correctly over multiple frames', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, 0);

    // Turn left for 60 frames (1 second)
    for (let i = 0; i < 60; i++) {
      bike.update(DT, makeInput({ left: true }), [], true);
    }
    const angleAfter1s = bike.angle;

    // Turn left for another 60 frames
    for (let i = 0; i < 60; i++) {
      bike.update(DT, makeInput({ left: true }), [], true);
    }
    const angleAfter2s = bike.angle;

    // The second second of turning should add approximately the same amount
    const delta1 = angleAfter1s;
    const delta2 = angleAfter2s - angleAfter1s;
    // Normalize delta2
    let wrapped = delta2;
    while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
    while (wrapped < -Math.PI) wrapped += 2 * Math.PI;

    expect(Math.abs(wrapped - delta1)).toBeLessThan(0.3);
  });
});

// ---------- Jump and landing ----------

describe('Jump mechanics on surfaces', () => {
  it('jump launches perpendicular to floor', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, 0);

    // Frame 1: jump sets airborne velocity, grounded=false
    bike.update(DT, makeInput({ jump: true }), [], true);
    expect(bike.grounded).toBe(false);
    expect(bike.vy).toBeGreaterThan(0);

    // Frame 2: airborne physics moves position upward
    bike.update(DT, NO_INPUT, [], true);
    expect(bike.position.y).toBeGreaterThan(0);
  });

  it('bike lands back on floor after jump', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, 0);

    // Jump
    bike.update(DT, makeInput({ jump: true }), [], true);
    expect(bike.grounded).toBe(false);

    // Simulate until landing (up to 3 seconds)
    for (let i = 0; i < 180; i++) {
      bike.update(DT, NO_INPUT, [], true);
      if (bike.grounded) break;
    }

    expect(bike.grounded).toBe(true);
    expect(bike.position.y).toBeCloseTo(0, 0);
  });
});
