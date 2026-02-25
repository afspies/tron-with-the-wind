import type { Vec2, Vec3, PlayerInput } from '@tron/shared';
import {
  BIKE_SPEED, TURN_RATE,
  JUMP_INITIAL_VY, GRAVITY, JUMP_COOLDOWN,
  BOOST_MULTIPLIER, BOOST_MAX, BOOST_DRAIN, BOOST_RECHARGE, BOOST_RECHARGE_DELAY,
  ARENA_HALF, TRAIL_DESTROY_RADIUS,
  DOUBLE_JUMP_COOLDOWN,
  DRIFT_TURN_RATE, DRIFT_SPEED_MULTIPLIER, DRIFT_SLIDE_FACTOR,
  DRIFT_MAX_DURATION, DRIFT_COOLDOWN,
} from '@tron/shared';
import { SimTrail } from './SimTrail';
import { checkTrailCollision, checkTrailCollisionDetailed, checkWallCollision, type TrailHitInfo } from './Collision';
import type { SimPowerUpEffect } from './powerups/SimPowerUpEffect';
import { createSimEffect } from './powerups/SimPowerUpRegistry';

export class SimBike {
  position: Vec3;
  angle: number;
  speed: number;
  vy = 0;
  alive = true;
  grounded = true;
  jumpCooldown = 0;
  boostMeter = BOOST_MAX;
  boosting = false;
  playerIndex: number;
  color: string;
  trail: SimTrail;

  activeEffect: SimPowerUpEffect | null = null;
  effectTimer = 0;

  get invulnerable(): boolean {
    return this.activeEffect?.type === 'invulnerability' && this.effectTimer > 0;
  }

  get invulnerableTimer(): number {
    return this.invulnerable ? this.effectTimer : 0;
  }

  lastTrailDestruction: TrailHitInfo | null = null;

  doubleJumpReady = true;
  doubleJumpCooldown = 0;
  usedDoubleJumpThisAirborne = false;
  boostRechargeTimer = 0;

  // Drift state
  drifting = false;
  driftTimer = 0;
  driftCooldown = 0;
  driftAngle = 0;         // pre-drift heading
  driftGhostPos: Vec2 = { x: 0, z: 0 }; // ghost trail position

  constructor(playerIndex: number, color: string, x: number, z: number, angle: number) {
    this.playerIndex = playerIndex;
    this.color = color;
    this.position = { x, y: 0, z };
    this.angle = angle;
    this.speed = BIKE_SPEED;
    this.trail = new SimTrail();
  }

  update(dt: number, input: PlayerInput, allTrails: SimTrail[], skipCollision = false): void {
    if (!this.alive) return;

    // Drift cooldown
    this.driftCooldown = Math.max(0, this.driftCooldown - dt);

    // Drift state transitions
    if (!this.drifting && input.drift && this.grounded && this.driftCooldown <= 0) {
      // Enter drift
      this.drifting = true;
      this.driftTimer = 0;
      this.driftAngle = this.angle;
      this.driftGhostPos = { x: this.position.x, z: this.position.z };
    } else if (this.drifting) {
      this.driftTimer += dt;
      if (!input.drift || !this.grounded || this.driftTimer >= DRIFT_MAX_DURATION) {
        this.endDrift();
      }
    }

    // Steering
    const turnRate = this.drifting ? DRIFT_TURN_RATE : TURN_RATE;
    if (input.left) this.angle += turnRate * dt;
    if (input.right) this.angle -= turnRate * dt;

    // Boost
    this.boosting = input.boost && this.boostMeter > 0;
    if (this.boosting) {
      this.boostMeter = Math.max(0, this.boostMeter - BOOST_DRAIN * dt);
      this.boostRechargeTimer = BOOST_RECHARGE_DELAY;
    } else {
      if (this.boostRechargeTimer > 0) {
        this.boostRechargeTimer -= dt;
      } else {
        const fillFraction = this.boostMeter / BOOST_MAX;
        const rate = BOOST_RECHARGE * (0.3 + 0.7 * fillFraction);
        this.boostMeter = Math.min(BOOST_MAX, this.boostMeter + rate * dt);
      }
    }
    const boostMul = this.boosting ? BOOST_MULTIPLIER : 1.0;
    const driftSpeedMul = this.drifting ? DRIFT_SPEED_MULTIPLIER : 1.0;
    const speedMul = boostMul * driftSpeedMul;

    // Forward direction
    const forwardX = Math.sin(this.angle);
    const forwardZ = Math.cos(this.angle);

    const oldPos: Vec2 = { x: this.position.x, z: this.position.z };

    // Move: during drift, blend facing direction with pre-drift direction
    if (this.drifting) {
      const driftForwardX = Math.sin(this.driftAngle);
      const driftForwardZ = Math.cos(this.driftAngle);
      const facingWeight = 1.0 - DRIFT_SLIDE_FACTOR;
      const moveX = forwardX * facingWeight + driftForwardX * DRIFT_SLIDE_FACTOR;
      const moveZ = forwardZ * facingWeight + driftForwardZ * DRIFT_SLIDE_FACTOR;
      this.position.x += moveX * this.speed * speedMul * dt;
      this.position.z += moveZ * this.speed * speedMul * dt;

      // Ghost trail advances straight at pre-drift angle at full speed (no drift penalty)
      const ghostSpeed = this.speed * boostMul;
      this.driftGhostPos.x += driftForwardX * ghostSpeed * dt;
      this.driftGhostPos.z += driftForwardZ * ghostSpeed * dt;
      // Clamp ghost to arena bounds
      this.driftGhostPos.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.driftGhostPos.x));
      this.driftGhostPos.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.driftGhostPos.z));
    } else {
      this.position.x += forwardX * this.speed * speedMul * dt;
      this.position.z += forwardZ * this.speed * speedMul * dt;
    }

    // Jump
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    if (input.jump && this.jumpCooldown <= 0) {
      if (this.grounded) {
        this.vy = JUMP_INITIAL_VY;
        this.grounded = false;
        this.jumpCooldown = JUMP_COOLDOWN;
        this.usedDoubleJumpThisAirborne = false;
      } else if (this.doubleJumpReady && !this.usedDoubleJumpThisAirborne) {
        this.vy = JUMP_INITIAL_VY;
        this.usedDoubleJumpThisAirborne = true;
        this.doubleJumpReady = false;
        this.doubleJumpCooldown = DOUBLE_JUMP_COOLDOWN;
        this.jumpCooldown = JUMP_COOLDOWN;
      }
    }

    if (!this.grounded) {
      this.position.y += this.vy * dt;
      this.vy -= GRAVITY * dt;
      if (this.position.y <= 0) {
        this.position.y = 0;
        this.vy = 0;
        this.grounded = true;
        this.jumpCooldown = JUMP_COOLDOWN;
      }
    }

    const newPos: Vec2 = { x: this.position.x, z: this.position.z };

    // Active effect update
    if (this.activeEffect) {
      if (!this.activeEffect.onUpdate(this, dt)) {
        const effect = this.activeEffect;
        this.activeEffect = null;
        effect.onExpire(this);
      }
    }

    // Double-jump cooldown
    if (!this.doubleJumpReady) {
      this.doubleJumpCooldown -= dt;
      if (this.doubleJumpCooldown <= 0) {
        this.doubleJumpReady = true;
        this.doubleJumpCooldown = 0;
      }
    }

    // Collision (uses bike's actual position)
    if (!skipCollision) {
      if (checkWallCollision(this.position.x, this.position.z)) {
        if (this.invulnerable) {
          this.position.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.x));
          this.position.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.z));
        } else {
          this.die();
          return;
        }
      }
      if (this.invulnerable) {
        const hit = checkTrailCollisionDetailed(oldPos, newPos, this.position.y, allTrails, this.playerIndex);
        if (hit && hit.trailIndex !== this.playerIndex) {
          allTrails[hit.trailIndex].deleteSegmentsInRadius(hit.contactX, hit.contactZ, TRAIL_DESTROY_RADIUS);
          this.lastTrailDestruction = hit;
        }
      } else {
        if (checkTrailCollision(oldPos, newPos, this.position.y, allTrails, this.playerIndex)) {
          this.die();
          return;
        }
      }
    }

    // Update trail: emit at ghost position during drift, actual position otherwise
    if (this.drifting) {
      this.trail.addPoint(this.driftGhostPos.x, this.position.y, this.driftGhostPos.z);
    } else {
      this.trail.addPoint(this.position.x, this.position.y, this.position.z);
    }
  }

  private endDrift(): void {
    this.drifting = false;
    this.driftCooldown = DRIFT_COOLDOWN;
    // The trail section at the bottom of update() will emit at the bike's actual position
    // (since drifting is now false), creating the reconnection segment from ghost to bike.
  }

  grantInvulnerability(): void {
    createSimEffect('invulnerability')?.onGrant(this);
  }

  private die(): void {
    this.alive = false;
    const effect = this.activeEffect;
    this.activeEffect = null;
    effect?.onExpire(this);
  }

  reset(x: number, z: number, angle: number): void {
    this.position = { x, y: 0, z };
    this.angle = angle;
    this.vy = 0;
    this.alive = true;
    this.grounded = true;
    this.jumpCooldown = 0;
    this.boostMeter = BOOST_MAX;
    this.boosting = false;
    const effect = this.activeEffect;
    this.activeEffect = null;
    effect?.onExpire(this);
    this.lastTrailDestruction = null;
    this.doubleJumpReady = true;
    this.doubleJumpCooldown = 0;
    this.usedDoubleJumpThisAirborne = false;
    this.boostRechargeTimer = 0;
    this.drifting = false;
    this.driftTimer = 0;
    this.driftCooldown = 0;
    this.driftAngle = 0;
    this.driftGhostPos = { x: 0, z: 0 };
    this.trail.reset();
  }
}
