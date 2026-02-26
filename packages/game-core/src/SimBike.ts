import type { Vec2, Vec3, PlayerInput } from '@tron/shared';
import {
  BIKE_SPEED, TURN_RATE,
  JUMP_INITIAL_VY, GRAVITY, JUMP_COOLDOWN,
  BOOST_MULTIPLIER, BOOST_MAX, BOOST_DRAIN, BOOST_RECHARGE, BOOST_RECHARGE_DELAY,
  ARENA_HALF, TRAIL_DESTROY_RADIUS,
  DOUBLE_JUMP_COOLDOWN,
  DRIFT_TURN_MULTIPLIER, DRIFT_SPEED_MULTIPLIER, DRIFT_TRACTION, NORMAL_TRACTION,
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

  drifting = false;
  velocityAngle!: number;
  driftTimer = 0;
  vx!: number;
  vz!: number;

  constructor(playerIndex: number, color: string, x: number, z: number, angle: number) {
    this.playerIndex = playerIndex;
    this.color = color;
    this.position = { x, y: 0, z };
    this.angle = angle;
    this.speed = BIKE_SPEED;
    this.initVelocity(angle);
    this.trail = new SimTrail();
  }

  update(dt: number, input: PlayerInput, allTrails: SimTrail[], skipCollision = false): void {
    if (!this.alive) return;

    // Drift state: ground-only, cancels on jump
    const wantsDrift = input.drift && this.grounded;
    if (wantsDrift !== this.drifting) {
      this.drifting = wantsDrift;
      this.driftTimer = 0;
    }
    if (this.drifting) this.driftTimer += dt;

    // Steering (faster turn rate while drifting)
    const turnRate = this.drifting ? TURN_RATE * DRIFT_TURN_MULTIPLIER : TURN_RATE;
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
    const driftMul = this.drifting ? DRIFT_SPEED_MULTIPLIER : 1.0;
    const currentSpeed = this.speed * (this.boosting ? BOOST_MULTIPLIER : 1.0) * driftMul;

    // Velocity vector traction blend
    const desiredVx = Math.sin(this.angle) * currentSpeed;
    const desiredVz = Math.cos(this.angle) * currentSpeed;
    const traction = this.drifting ? DRIFT_TRACTION : NORMAL_TRACTION;
    const blendFactor = 1 - Math.exp(-traction * dt);
    this.vx += (desiredVx - this.vx) * blendFactor;
    this.vz += (desiredVz - this.vz) * blendFactor;

    // Renormalize to maintain constant speed
    const len = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    if (len > 0.001) {
      this.vx = (this.vx / len) * currentSpeed;
      this.vz = (this.vz / len) * currentSpeed;
    }

    // Derive velocityAngle for schema sync and visuals
    this.velocityAngle = Math.atan2(this.vx, this.vz);

    const oldPos: Vec2 = { x: this.position.x, z: this.position.z };

    // Move
    this.position.x += this.vx * dt;
    this.position.z += this.vz * dt;

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

    // Collision
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

    // Update trail
    this.trail.addPoint(this.position.x, this.position.y, this.position.z);
  }

  grantInvulnerability(): void {
    createSimEffect('invulnerability')?.onGrant(this);
  }

  private initVelocity(angle: number): void {
    this.velocityAngle = angle;
    this.vx = Math.sin(angle) * BIKE_SPEED;
    this.vz = Math.cos(angle) * BIKE_SPEED;
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
    this.initVelocity(angle);
    this.trail.reset();
  }
}
