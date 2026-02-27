import type { Vec2, Vec3, PlayerInput, DeathCause } from '@tron/shared';
import {
  BIKE_SPEED, TURN_RATE,
  JUMP_INITIAL_VY, GRAVITY, JUMP_COOLDOWN,
  BOOST_MULTIPLIER, BOOST_MAX, BOOST_DRAIN, BOOST_RECHARGE, BOOST_RECHARGE_DELAY,
  ARENA_HALF, TRAIL_DESTROY_RADIUS,
  DOUBLE_JUMP_COOLDOWN,
  DRIFT_TURN_MULTIPLIER, DRIFT_SPEED_MULTIPLIER, DRIFT_TRACTION, NORMAL_TRACTION,
  FLIGHT_PITCH_RATE, FLIGHT_PITCH_RETURN_RATE, FLIGHT_MAX_PITCH,
  FLIGHT_THRUST, FLIGHT_AIR_TURN_MULT, FLIGHT_BOOST_DRAIN_MULT,
  FLIGHT_LANDING_MAX_PITCH,
} from '@tron/shared';
import { SimTrail } from './SimTrail';
import { checkTrailCollision, checkTrailCollisionDetailed, checkWallCollision, type TrailHitInfo } from './Collision';
import type { SimPowerUpEffect } from './powerups/SimPowerUpEffect';
import { createSimEffect } from './powerups/SimPowerUpRegistry';

export interface DeathInfo {
  cause: DeathCause;
  trailIndex: number; // -1 for wall
  contactX: number;
  contactZ: number;
}

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

  pitch = 0;
  flying = false;

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

  update(dt: number, input: PlayerInput, allTrails: SimTrail[], skipCollision = false): DeathInfo | null {
    if (!this.alive) return null;

    // Drift state: ground-only, cancels on jump
    const wantsDrift = input.drift && this.grounded;
    if (wantsDrift !== this.drifting) {
      this.drifting = wantsDrift;
      this.driftTimer = 0;
    }
    if (this.drifting) this.driftTimer += dt;

    // Steering (faster turn rate while drifting, slower while flying)
    const turnRate = this.drifting ? TURN_RATE * DRIFT_TURN_MULTIPLIER
      : this.flying ? TURN_RATE * FLIGHT_AIR_TURN_MULT
      : TURN_RATE;
    if (input.left) this.angle += turnRate * dt;
    if (input.right) this.angle -= turnRate * dt;

    // Boost
    this.boosting = input.boost && this.boostMeter > 0;
    this.flying = !this.grounded && this.boosting;

    if (this.boosting) {
      const drain = this.flying ? BOOST_DRAIN * FLIGHT_BOOST_DRAIN_MULT : BOOST_DRAIN;
      this.boostMeter = Math.max(0, this.boostMeter - drain * dt);
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

    // Pitch update — player-controlled via W/S whenever airborne
    if (!this.grounded) {
      if (input.pitchUp) {
        this.pitch = Math.min(FLIGHT_MAX_PITCH, this.pitch + FLIGHT_PITCH_RATE * dt);
      } else if (input.pitchDown) {
        this.pitch = Math.max(0, this.pitch - FLIGHT_PITCH_RATE * dt);
      }
    } else {
      this.pitch = 0;
    }

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
    if (this.flying) {
      // Flight overrides traction: use heading direction with pitch-based speed
      const horizSpeed = BIKE_SPEED * BOOST_MULTIPLIER * Math.cos(this.pitch);
      this.position.x += Math.sin(this.angle) * horizSpeed * dt;
      this.position.z += Math.cos(this.angle) * horizSpeed * dt;
      this.vy += FLIGHT_THRUST * Math.sin(this.pitch) * dt;
    } else if (!this.grounded && this.pitch > 0) {
      // Airborne coasting with residual pitch (no vertical thrust)
      const horizSpeed = BIKE_SPEED * Math.cos(this.pitch);
      this.position.x += Math.sin(this.angle) * horizSpeed * dt;
      this.position.z += Math.cos(this.angle) * horizSpeed * dt;
    } else {
      // Ground / normal air: use velocity traction model
      this.position.x += this.vx * dt;
      this.position.z += this.vz * dt;
    }

    // Jump
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    if (input.jump && this.jumpCooldown <= 0) {
      if (this.grounded) {
        this.vy = JUMP_INITIAL_VY;
        this.grounded = false;
        this.jumpCooldown = JUMP_COOLDOWN;
        this.usedDoubleJumpThisAirborne = false;
      } else if (this.doubleJumpReady) {
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
        if (this.pitch > FLIGHT_LANDING_MAX_PITCH) {
          this.die();
          return { cause: 'self', trailIndex: this.playerIndex, contactX: this.position.x, contactZ: this.position.z };
        }
        this.position.y = 0;
        this.vy = 0;
        this.grounded = true;
        this.pitch = 0;
        this.flying = false;
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
          return { cause: 'wall', trailIndex: -1, contactX: this.position.x, contactZ: this.position.z };
        }
      }
      if (this.invulnerable) {
        const hit = checkTrailCollisionDetailed(oldPos, newPos, this.position.y, allTrails, this.playerIndex);
        if (hit && hit.trailIndex !== this.playerIndex) {
          allTrails[hit.trailIndex].deleteSegmentsInRadius(hit.contactX, hit.contactZ, TRAIL_DESTROY_RADIUS);
          this.lastTrailDestruction = hit;
        }
      } else {
        const hit = checkTrailCollisionDetailed(oldPos, newPos, this.position.y, allTrails, this.playerIndex);
        if (hit) {
          this.die();
          const cause: DeathCause = hit.trailIndex === this.playerIndex ? 'self' : 'trail';
          return { cause, trailIndex: hit.trailIndex, contactX: hit.contactX, contactZ: hit.contactZ };
        }
      }
    }

    // Update trail
    this.trail.addPoint(this.position.x, this.position.y, this.position.z);
    return null;
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
    this.pitch = 0;
    this.flying = false;
    this.trail.reset();
  }
}
