import type { Vec2, Vec3, PlayerInput } from '@tron/shared';
import {
  SurfaceType, getSurfaceNormal,
  BIKE_SPEED, TURN_RATE,
  JUMP_INITIAL_VY, GRAVITY, JUMP_COOLDOWN,
  BOOST_MULTIPLIER, BOOST_MAX, BOOST_DRAIN, BOOST_RECHARGE, BOOST_RECHARGE_DELAY,
  ARENA_HALF, TRAIL_DESTROY_RADIUS,
  DOUBLE_JUMP_COOLDOWN,
  DRIFT_TURN_MULTIPLIER, DRIFT_SPEED_MULTIPLIER, DRIFT_TRACTION, NORMAL_TRACTION,
  FLIGHT_PITCH_RATE, FLIGHT_PITCH_RETURN_RATE, FLIGHT_MAX_PITCH,
  FLIGHT_THRUST, FLIGHT_AIR_TURN_MULT, FLIGHT_BOOST_DRAIN_MULT,
  FLIGHT_LANDING_MAX_PITCH,
  CEILING_HEIGHT, WALL_MIN_SPEED, WALL_MAX_SPEED, CEILING_RESTITUTION, WALL_ATTACH_MIN_VEL,
} from '@tron/shared';
import { SimTrail } from './SimTrail';
import { checkTrailCollision, checkTrailCollisionDetailed, checkWallCollision, type TrailHitInfo } from './Collision';
import type { SimPowerUpEffect } from './powerups/SimPowerUpEffect';
import { createSimEffect } from './powerups/SimPowerUpRegistry';
import {
  rotateVectorAroundAxis,
  remapForwardToWall,
  remapForwardToFloor,
  projectOntoSurfacePlane,
  getWallSurfaceFromPosition,
} from './Surface';

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

  // Wall driving state
  surfaceType: SurfaceType = SurfaceType.Floor;
  surfaceNormal: Vec3 = { x: 0, y: 1, z: 0 };
  forward: Vec3 = { x: 0, y: 0, z: 1 };
  canWallDrive = true; // Set to false for AI bikes

  constructor(playerIndex: number, color: string, x: number, z: number, angle: number) {
    this.playerIndex = playerIndex;
    this.color = color;
    this.position = { x, y: 0, z };
    this.angle = angle;
    this.speed = BIKE_SPEED;
    this.forward = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
    this.initVelocity(angle);
    this.trail = new SimTrail();
  }

  update(dt: number, input: PlayerInput, allTrails: SimTrail[], skipCollision = false): void {
    if (!this.alive) return;

    // Common: boost meter management
    this.updateBoost(dt, input);

    // Common: double-jump cooldown
    if (!this.doubleJumpReady) {
      this.doubleJumpCooldown -= dt;
      if (this.doubleJumpCooldown <= 0) {
        this.doubleJumpReady = true;
        this.doubleJumpCooldown = 0;
      }
    }

    // Common: active effect update
    if (this.activeEffect) {
      if (!this.activeEffect.onUpdate(this, dt)) {
        const effect = this.activeEffect;
        this.activeEffect = null;
        effect.onExpire(this);
      }
    }

    // Jump cooldown
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);

    // Dispatch to surface-specific update
    switch (this.surfaceType) {
      case SurfaceType.Floor:
        this.updateFloor(dt, input, allTrails, skipCollision);
        break;
      case SurfaceType.WallXPos:
      case SurfaceType.WallXNeg:
      case SurfaceType.WallZPos:
      case SurfaceType.WallZNeg:
        this.updateWall(dt, input, allTrails, skipCollision);
        break;
      case SurfaceType.Air:
        this.updateAir(dt, input, allTrails, skipCollision);
        break;
    }

    if (!this.alive) return;

    // Derive backward-compat fields
    this.angle = Math.atan2(this.forward.x, this.forward.z);
    this.velocityAngle = Math.atan2(this.vx, this.vz);

    // Update trail
    this.trail.addPoint(this.position.x, this.position.y, this.position.z);
  }

  // ─── Floor Physics (mostly unchanged from original) ────────────────────────

  private updateFloor(dt: number, input: PlayerInput, allTrails: SimTrail[], skipCollision: boolean): void {
    // Drift state: ground-only
    const wantsDrift = input.drift && this.grounded;
    if (wantsDrift !== this.drifting) {
      this.drifting = wantsDrift;
      this.driftTimer = 0;
    }
    if (this.drifting) this.driftTimer += dt;

    // Steering
    const turnRate = this.drifting ? TURN_RATE * DRIFT_TURN_MULTIPLIER : TURN_RATE;
    if (input.left) this.angle += turnRate * dt;
    if (input.right) this.angle -= turnRate * dt;

    // Update forward from angle
    this.forward = { x: Math.sin(this.angle), y: 0, z: Math.cos(this.angle) };

    const driftMul = this.drifting ? DRIFT_SPEED_MULTIPLIER : 1.0;
    const currentSpeed = this.speed * (this.boosting ? BOOST_MULTIPLIER : 1.0) * driftMul;

    this.pitch = 0;

    // Velocity traction blend
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

    const oldPos: Vec2 = { x: this.position.x, z: this.position.z };

    // Move
    this.position.x += this.vx * dt;
    this.position.z += this.vz * dt;

    // Jump from floor
    if (input.jump && this.jumpCooldown <= 0) {
      this.vy = JUMP_INITIAL_VY;
      this.grounded = false;
      this.jumpCooldown = JUMP_COOLDOWN;
      this.usedDoubleJumpThisAirborne = false;
      this.surfaceType = SurfaceType.Air;
      this.drifting = false;
      this.driftTimer = 0;
      // Continue to air collision below but skip the wall-attach check
    }

    const newPos: Vec2 = { x: this.position.x, z: this.position.z };

    // Collision
    if (!skipCollision) {
      // Check wall boundary - try to attach instead of die
      if (checkWallCollision(this.position.x, this.position.z)) {
        if (this.invulnerable) {
          this.position.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.x));
          this.position.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.z));
        } else if (!this.tryAttachToWall()) {
          this.die();
          return;
        }
      }

      // Trail collision
      this.checkTrailCollisionFloor(oldPos, newPos, allTrails);
      if (!this.alive) return;
    }
  }

  // ─── Wall Physics ──────────────────────────────────────────────────────────

  private updateWall(dt: number, input: PlayerInput, allTrails: SimTrail[], skipCollision: boolean): void {
    this.drifting = false;
    this.driftTimer = 0;

    // Steering: rotate forward around surfaceNormal
    const turnRate = TURN_RATE;
    if (input.left) {
      this.forward = rotateVectorAroundAxis(this.forward, this.surfaceNormal, turnRate * dt);
    }
    if (input.right) {
      this.forward = rotateVectorAroundAxis(this.forward, this.surfaceNormal, -turnRate * dt);
    }

    const currentSpeed = this.speed * (this.boosting ? BOOST_MULTIPLIER : 1.0);

    // 3D velocity: desired = forward * speed
    const desiredVx = this.forward.x * currentSpeed;
    const desiredVy = this.forward.y * currentSpeed;
    const desiredVz = this.forward.z * currentSpeed;

    // Traction blend in 3D
    const blendFactor = 1 - Math.exp(-NORMAL_TRACTION * dt);
    this.vx += (desiredVx - this.vx) * blendFactor;
    this.vy += (desiredVy - this.vy) * blendFactor;
    this.vz += (desiredVz - this.vz) * blendFactor;

    // Apply gravity directly to velocity (NOT renormalized - this is key)
    this.vy -= GRAVITY * dt;

    // Compute speed (3D magnitude)
    let speed3d = Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);

    // Clamp speed
    if (speed3d > WALL_MAX_SPEED) {
      const scale = WALL_MAX_SPEED / speed3d;
      this.vx *= scale;
      this.vy *= scale;
      this.vz *= scale;
      speed3d = WALL_MAX_SPEED;
    }

    // If too slow, detach from wall
    if (speed3d < WALL_MIN_SPEED) {
      this.detachFromWall();
      return;
    }

    // Move
    this.position.x += this.vx * dt;
    this.position.y += this.vy * dt;
    this.position.z += this.vz * dt;

    // Snap to wall surface (constrain the fixed axis)
    this.snapToWall();

    // Update forward from velocity (projected onto wall plane)
    const projForward = projectOntoSurfacePlane(
      { x: this.vx, y: this.vy, z: this.vz },
      this.surfaceNormal,
    );
    if (projForward.x !== 0 || projForward.y !== 0 || projForward.z !== 0) {
      this.forward = projForward;
    }

    // Check ceiling
    if (this.position.y >= CEILING_HEIGHT) {
      this.bounceOffCeiling();
      return;
    }

    // Check floor (reached bottom of wall)
    if (this.position.y <= 0) {
      this.transitionWallToFloor();
      return;
    }

    // Jump off wall: impulse along surfaceNormal
    if (input.jump && this.jumpCooldown <= 0) {
      const jumpSpeed = JUMP_INITIAL_VY;
      this.vx += this.surfaceNormal.x * jumpSpeed;
      this.vy += this.surfaceNormal.y * jumpSpeed;
      this.vz += this.surfaceNormal.z * jumpSpeed;
      this.surfaceType = SurfaceType.Air;
      this.surfaceNormal = { x: 0, y: 1, z: 0 };
      this.grounded = false;
      this.jumpCooldown = JUMP_COOLDOWN;
      this.usedDoubleJumpThisAirborne = false;
      return;
    }

    // Trail collision on wall (skip for now, will be added in Step 4)
    if (!skipCollision) {
      // Wall trail collision handled in Collision.ts update
    }
  }

  // ─── Air Physics (extended with ceiling bounce + wall attach) ──────────────

  private updateAir(dt: number, input: PlayerInput, allTrails: SimTrail[], skipCollision: boolean): void {
    this.drifting = false;
    this.driftTimer = 0;

    this.flying = this.boosting;

    // Steering
    const turnRate = this.flying ? TURN_RATE * FLIGHT_AIR_TURN_MULT : TURN_RATE;
    if (input.left) this.angle += turnRate * dt;
    if (input.right) this.angle -= turnRate * dt;
    this.forward = { x: Math.sin(this.angle), y: 0, z: Math.cos(this.angle) };

    // Pitch
    if (input.pitchUp) {
      this.pitch = Math.min(FLIGHT_MAX_PITCH, this.pitch + FLIGHT_PITCH_RATE * dt);
    } else if (input.pitchDown) {
      this.pitch = Math.max(0, this.pitch - FLIGHT_PITCH_RATE * dt);
    }

    const driftMul = 1.0;
    const currentSpeed = this.speed * (this.boosting ? BOOST_MULTIPLIER : 1.0) * driftMul;

    // Velocity traction blend (XZ plane)
    const desiredVx = Math.sin(this.angle) * currentSpeed;
    const desiredVz = Math.cos(this.angle) * currentSpeed;
    const blendFactor = 1 - Math.exp(-NORMAL_TRACTION * dt);
    this.vx += (desiredVx - this.vx) * blendFactor;
    this.vz += (desiredVz - this.vz) * blendFactor;
    const len = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    if (len > 0.001) {
      this.vx = (this.vx / len) * currentSpeed;
      this.vz = (this.vz / len) * currentSpeed;
    }

    const oldPos: Vec2 = { x: this.position.x, z: this.position.z };

    // Move
    if (this.flying) {
      const horizSpeed = BIKE_SPEED * BOOST_MULTIPLIER * Math.cos(this.pitch);
      this.position.x += Math.sin(this.angle) * horizSpeed * dt;
      this.position.z += Math.cos(this.angle) * horizSpeed * dt;
      this.vy += FLIGHT_THRUST * Math.sin(this.pitch) * dt;
    } else if (this.pitch > 0) {
      const horizSpeed = BIKE_SPEED * Math.cos(this.pitch);
      this.position.x += Math.sin(this.angle) * horizSpeed * dt;
      this.position.z += Math.cos(this.angle) * horizSpeed * dt;
    } else {
      this.position.x += this.vx * dt;
      this.position.z += this.vz * dt;
    }

    // Double-jump
    if (input.jump && this.jumpCooldown <= 0 && this.doubleJumpReady) {
      this.vy = JUMP_INITIAL_VY;
      this.usedDoubleJumpThisAirborne = true;
      this.doubleJumpReady = false;
      this.doubleJumpCooldown = DOUBLE_JUMP_COOLDOWN;
      this.jumpCooldown = JUMP_COOLDOWN;
    }

    // Gravity
    this.position.y += this.vy * dt;
    this.vy -= GRAVITY * dt;

    // Ceiling bounce
    if (this.position.y >= CEILING_HEIGHT) {
      this.bounceOffCeiling();
    }

    // Landing
    if (this.position.y <= 0) {
      if (this.pitch > FLIGHT_LANDING_MAX_PITCH) {
        this.die();
        return;
      }
      this.position.y = 0;
      this.vy = 0;
      this.grounded = true;
      this.pitch = 0;
      this.flying = false;
      this.surfaceType = SurfaceType.Floor;
      this.surfaceNormal = { x: 0, y: 1, z: 0 };
      this.jumpCooldown = JUMP_COOLDOWN;
    }

    const newPos: Vec2 = { x: this.position.x, z: this.position.z };

    // Collision
    if (!skipCollision) {
      // Wall boundary: try to attach to wall while airborne
      if (checkWallCollision(this.position.x, this.position.z)) {
        if (this.invulnerable) {
          this.position.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.x));
          this.position.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.z));
        } else if (this.position.y > 0) {
          // Airborne - attach to wall
          if (!this.tryAttachToWall()) {
            this.die();
            return;
          }
        } else {
          this.die();
          return;
        }
      }

      // Trail collision
      this.checkTrailCollisionFloor(oldPos, newPos, allTrails);
      if (!this.alive) return;
    }
  }

  // ─── Surface Transitions ───────────────────────────────────────────────────

  private tryAttachToWall(): boolean {
    if (!this.canWallDrive) return false;

    // Determine which wall we're hitting
    let wallSurface: SurfaceType | null = null;
    if (this.position.x >= ARENA_HALF) wallSurface = SurfaceType.WallXPos;
    else if (this.position.x <= -ARENA_HALF) wallSurface = SurfaceType.WallXNeg;
    else if (this.position.z >= ARENA_HALF) wallSurface = SurfaceType.WallZPos;
    else if (this.position.z <= -ARENA_HALF) wallSurface = SurfaceType.WallZNeg;

    if (!wallSurface) return false;

    const wallNormal = getSurfaceNormal(wallSurface);

    // Check velocity toward wall (dot with -normal, since normal points inward)
    const velTowardWall = -(this.vx * wallNormal.x + this.vy * wallNormal.y + this.vz * wallNormal.z);
    if (velTowardWall < WALL_ATTACH_MIN_VEL) return false;

    // Remap forward vector
    this.forward = remapForwardToWall(this.forward, wallSurface);

    // Remove the normal component from velocity and add the former toward-wall as upward
    // Project velocity onto wall plane
    const dot = this.vx * wallNormal.x + this.vy * wallNormal.y + this.vz * wallNormal.z;
    this.vx -= dot * wallNormal.x;
    this.vy -= dot * wallNormal.y;
    this.vz -= dot * wallNormal.z;

    // The toward-wall velocity becomes upward velocity on the wall
    this.vy += velTowardWall;

    // Snap to wall
    this.surfaceType = wallSurface;
    this.surfaceNormal = wallNormal;
    this.grounded = true;
    this.pitch = 0;
    this.flying = false;
    this.snapToWall();

    return true;
  }

  private transitionWallToFloor(): void {
    this.forward = remapForwardToFloor(this.forward, this.surfaceType);
    this.angle = Math.atan2(this.forward.x, this.forward.z);
    this.position.y = 0;
    this.vy = 0;
    this.surfaceType = SurfaceType.Floor;
    this.surfaceNormal = { x: 0, y: 1, z: 0 };
    this.grounded = true;
    this.pitch = 0;
    this.flying = false;

    // Re-derive 2D velocity from forward
    this.vx = this.forward.x * this.speed;
    this.vz = this.forward.z * this.speed;
    this.jumpCooldown = JUMP_COOLDOWN;
  }

  private detachFromWall(): void {
    this.surfaceType = SurfaceType.Air;
    this.surfaceNormal = { x: 0, y: 1, z: 0 };
    this.grounded = false;
    // Keep current 3D velocity (will be affected by gravity in air)
    // Forward stays as-is; air update will override from angle
    this.angle = Math.atan2(this.forward.x, this.forward.z);
  }

  private bounceOffCeiling(): void {
    this.position.y = CEILING_HEIGHT - 0.1;
    this.vy = -Math.abs(this.vy) * CEILING_RESTITUTION;

    // If on wall, detach
    if (this.surfaceType !== SurfaceType.Air && this.surfaceType !== SurfaceType.Floor) {
      this.detachFromWall();
    }
  }

  private snapToWall(): void {
    switch (this.surfaceType) {
      case SurfaceType.WallXPos:
        this.position.x = ARENA_HALF;
        break;
      case SurfaceType.WallXNeg:
        this.position.x = -ARENA_HALF;
        break;
      case SurfaceType.WallZPos:
        this.position.z = ARENA_HALF;
        break;
      case SurfaceType.WallZNeg:
        this.position.z = -ARENA_HALF;
        break;
    }
  }

  // ─── Common Helpers ────────────────────────────────────────────────────────

  private updateBoost(dt: number, input: PlayerInput): void {
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
  }

  private checkTrailCollisionFloor(oldPos: Vec2, newPos: Vec2, allTrails: SimTrail[]): void {
    if (this.invulnerable) {
      const hit = checkTrailCollisionDetailed(oldPos, newPos, this.position.y, allTrails, this.playerIndex);
      if (hit && hit.trailIndex !== this.playerIndex) {
        allTrails[hit.trailIndex].deleteSegmentsInRadius(hit.contactX, hit.contactZ, TRAIL_DESTROY_RADIUS);
        this.lastTrailDestruction = hit;
      }
    } else {
      if (checkTrailCollision(oldPos, newPos, this.position.y, allTrails, this.playerIndex)) {
        this.die();
      }
    }
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
    this.surfaceType = SurfaceType.Floor;
    this.surfaceNormal = { x: 0, y: 1, z: 0 };
    this.forward = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
    this.trail.reset();
  }
}
