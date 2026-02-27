import { NO_INPUT, ARENA_HALF, TRAIL_HEIGHT, BIKE_SPEED, BIKE_COLLISION_HEIGHT, CURVE_RADIUS } from '@tron/shared';
import type { PlayerInput, AIDifficulty, Vec2 } from '@tron/shared';
import type { SimBike } from './SimBike';
import type { SimTrail } from './SimTrail';
import { lineSegmentsIntersect } from './Collision';

interface AIConfig {
  lookAhead: number;
  reactionInterval: number;
  canJump: boolean;
  noiseAmount: number;
}

const AI_CONFIGS: Record<AIDifficulty, AIConfig> = {
  easy: { lookAhead: 30, reactionInterval: 250, canJump: false, noiseAmount: 0.3 },
  medium: { lookAhead: 50, reactionInterval: 150, canJump: true, noiseAmount: 0.15 },
  hard: { lookAhead: 80, reactionInterval: 100, canJump: true, noiseAmount: 0.05 },
};

export class AIController {
  private config: AIConfig;
  private lastDecisionTime = 0;
  private currentInput: PlayerInput = NO_INPUT;
  private steerBias = 0;

  constructor(difficulty: AIDifficulty) {
    this.config = AI_CONFIGS[difficulty];
  }

  getInput(bike: SimBike, allTrails: SimTrail[], time: number, powerUpPositions?: Array<{ x: number; z: number }>): PlayerInput {
    if (time - this.lastDecisionTime < this.config.reactionInterval / 1000) {
      return this.currentInput;
    }
    this.lastDecisionTime = time;

    const bikeY = bike.position.y;
    const angles = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2];
    const distances: number[] = [];

    for (const da of angles) {
      const testAngle = bike.angle + da;
      const dist = this.castRay(bike.position.x, bike.position.z, bikeY, testAngle, allTrails, bike.playerIndex);
      distances.push(dist);
    }

    let bestIdx = 0;
    let bestDist = distances[0];
    for (let i = 1; i < distances.length; i++) {
      if (distances[i] > bestDist) {
        bestDist = distances[i];
        bestIdx = i;
      }
    }

    const input: PlayerInput = { ...NO_INPUT };

    if (bestIdx === 0) {
      if (Math.random() < this.config.noiseAmount) {
        if (Math.random() < 0.5 + this.steerBias) {
          input.left = true;
        } else {
          input.right = true;
        }
      }
    } else if (angles[bestIdx] > 0) {
      input.left = true;
      this.steerBias = 0.2;
    } else {
      input.right = true;
      this.steerBias = -0.2;
    }

    if (this.config.canJump && distances[0] < BIKE_SPEED * 1.2 && distances[0] > 5) {
      const aheadDist = distances[0];
      const jumpDist = BIKE_SPEED * 1.1;
      if (aheadDist < jumpDist && (bike.grounded || (bike.doubleJumpReady && !bike.usedDoubleJumpThisAirborne))) {
        input.jump = true;
      }
    }

    if (distances[0] < 8) {
      const leftDist = Math.max(distances[1], distances[3], distances[5]);
      const rightDist = Math.max(distances[2], distances[4], distances[6]);
      input.left = leftDist > rightDist;
      input.right = !input.left;
    }

    // Medium/hard AI steers toward nearby power-ups when safe
    const canSeekPowerUp = this.config !== AI_CONFIGS.easy
      && powerUpPositions && powerUpPositions.length > 0
      && !bike.invulnerable
      && distances[0] > 20;

    if (canSeekPowerUp) {
      this.steerTowardPowerUp(input, bike, powerUpPositions!);
    }

    if (this.config === AI_CONFIGS.hard && (distances[0] > 40 || bike.invulnerable)) {
      input.boost = true;
    }

    // Prevent AI from accidentally triggering flight
    if (input.boost && !bike.grounded && bike.usedDoubleJumpThisAirborne) {
      input.boost = false;
    }

    this.currentInput = input;
    return input;
  }

  private steerTowardPowerUp(
    input: PlayerInput,
    bike: SimBike,
    powerUpPositions: Array<{ x: number; z: number }>,
  ): void {
    let closestDist = Infinity;
    let closestPU: { x: number; z: number } | null = null;
    for (const pu of powerUpPositions) {
      const dx = pu.x - bike.position.x;
      const dz = pu.z - bike.position.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < closestDist) {
        closestDist = d;
        closestPU = pu;
      }
    }
    if (!closestPU || closestDist >= 60) return;

    const toPU = Math.atan2(closestPU.x - bike.position.x, closestPU.z - bike.position.z);
    let da = toPU - bike.angle;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    if (Math.abs(da) > 0.1) {
      input.left = da > 0;
      input.right = da < 0;
    }
  }

  private castRay(
    startX: number,
    startZ: number,
    bikeY: number,
    angle: number,
    allTrails: SimTrail[],
    ownIndex: number,
  ): number {
    const step = 1.0;
    const maxDist = this.config.lookAhead;
    const dx = Math.sin(angle) * step;
    const dz = Math.cos(angle) * step;

    let px = startX;
    let pz = startZ;

    for (let d = 0; d < maxDist; d += step) {
      const nx = px + dx;
      const nz = pz + dz;

      // Treat curve zones as obstacles — AI stays on the floor
      const aiBoundary = ARENA_HALF - CURVE_RADIUS;
      if (Math.abs(nx) > aiBoundary || Math.abs(nz) > aiBoundary) {
        return d;
      }

      const p1: Vec2 = { x: px, z: pz };
      const p2: Vec2 = { x: nx, z: nz };

      for (let t = 0; t < allTrails.length; t++) {
        const trail = allTrails[t];
        const pts = trail.points;
        const skipEnd = t === ownIndex ? 5 : 0;
        const endIdx = pts.length - 1 - skipEnd;

        for (let i = 0; i < endIdx; i++) {
          if (isNaN(pts[i].x) || isNaN(pts[i + 1].x)) continue;
          if (lineSegmentsIntersect(p1, p2, pts[i], pts[i + 1])) {
            const trailY = (pts[i].y + pts[i + 1].y) / 2;
            if (bikeY < trailY + TRAIL_HEIGHT && bikeY + BIKE_COLLISION_HEIGHT > trailY) {
              return d;
            }
          }
        }
      }

      px = nx;
      pz = nz;
    }

    return maxDist;
  }
}
