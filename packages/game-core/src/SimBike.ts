import type { Vec2, Vec3, PlayerInput } from '@tron/shared';
import {
  SurfaceType,
  BIKE_SPEED, TURN_RATE,
  JUMP_INITIAL_VY, GRAVITY, JUMP_COOLDOWN,
  BOOST_MULTIPLIER, BOOST_MAX, BOOST_DRAIN, BOOST_RECHARGE, BOOST_RECHARGE_DELAY,
  ARENA_HALF, TRAIL_DESTROY_RADIUS,
  DOUBLE_JUMP_COOLDOWN,
  DRIFT_TURN_MULTIPLIER, DRIFT_SPEED_MULTIPLIER, DRIFT_TRACTION, NORMAL_TRACTION,
  FLIGHT_PITCH_RATE, FLIGHT_MAX_PITCH,
  FLIGHT_THRUST, FLIGHT_AIR_TURN_MULT, FLIGHT_BOOST_DRAIN_MULT,
  FLIGHT_LANDING_MAX_PITCH,
  CEILING_HEIGHT, WALL_MIN_SPEED, WALL_MAX_SPEED, CEILING_RESTITUTION, WALL_ATTACH_MIN_VEL,
} from '@tron/shared';
import { SimTrail } from './SimTrail';
import { checkTrailCollisionDetailed, checkTrailCollisionOnWall, checkWallCollision, type TrailHitInfo } from './Collision';
import type { SimPowerUpEffect } from './powerups/SimPowerUpEffect';
import { createSimEffect } from './powerups/SimPowerUpRegistry';
import { rotateVectorAroundAxis, projectOntoSurfacePlane } from './Surface';
import { getArenaSurfaceInfo, getGravityTangent } from './ArenaSurface';

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

  // Surface driving state
  surfaceType: SurfaceType = SurfaceType.Floor;
  surfaceNormal: Vec3 = { x: 0, y: 1, z: 0 };
  forward: Vec3 = { x: 0, y: 0, z: 1 };
  onSurface = true;
  canWallDrive = true;

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

    if (this.onSurface) {
      this.updateOnSurface(dt, input, allTrails, skipCollision);
    } else {
      this.updateAir(dt, input, allTrails, skipCollision);
    }

    if (!this.alive) return;

    // Derive backward-compat fields
    this.angle = Math.atan2(this.forward.x, this.forward.z);
    this.velocityAngle = Math.atan2(this.vx, this.vz);

    // Update trail
    this.trail.addPoint(this.position.x, this.position.y, this.position.z);
  }

  // ─── Unified Surface Physics (floor, ramp, wall) ─────────────────────────

  private updateOnSurface(dt: number, input: PlayerInput, allTrails: SimTrail[], skipCollision: boolean): void {
    // Recompute surface info from current position (continuous normal)
    const surfInfo = getArenaSurfaceInfo(this.position);
    this.surfaceNormal = surfInfo.normal;
    this.surfaceType = surfInfo.surfaceType;

    let isFloorLike = this.surfaceNormal.y > 0.7;
    let isWallLike = !isFloorLike;

    // Drift: only on floor-like surfaces
    if (isFloorLike) {
      const wantsDrift = input.drift && this.grounded;
      if (wantsDrift !== this.drifting) {
        this.drifting = wantsDrift;
        this.driftTimer = 0;
      }
      if (this.drifting) this.driftTimer += dt;
    } else {
      if (this.drifting) {
        this.drifting = false;
        this.driftTimer = 0;
      }
    }

    // Steering: rotate forward around surfaceNormal
    const turnRate = this.drifting ? TURN_RATE * DRIFT_TURN_MULTIPLIER : TURN_RATE;
    if (input.left) {
      this.forward = rotateVectorAroundAxis(this.forward, this.surfaceNormal, turnRate * dt);
    }
    if (input.right) {
      this.forward = rotateVectorAroundAxis(this.forward, this.surfaceNormal, -turnRate * dt);
    }

    // Ensure forward stays in the surface plane (numerical drift correction)
    this.forward = projectOntoSurfacePlane(this.forward, this.surfaceNormal);
    if (this.forward.x === 0 && this.forward.y === 0 && this.forward.z === 0) {
      // Degenerate case: reset forward to something sensible
      this.forward = projectOntoSurfacePlane({ x: 0, y: 0, z: 1 }, this.surfaceNormal);
      if (this.forward.x === 0 && this.forward.y === 0 && this.forward.z === 0) {
        this.forward = { x: 1, y: 0, z: 0 };
      }
    }

    this.pitch = 0;
    this.flying = false;

    const driftMul = this.drifting ? DRIFT_SPEED_MULTIPLIER : 1.0;
    const currentSpeed = this.speed * (this.boosting ? BOOST_MULTIPLIER : 1.0) * driftMul;

    // Desired velocity = forward * speed (in 3D, in the surface plane)
    const desiredVx = this.forward.x * currentSpeed;
    const desiredVy = this.forward.y * currentSpeed;
    const desiredVz = this.forward.z * currentSpeed;

    // Traction blend in 3D
    const traction = this.drifting ? DRIFT_TRACTION : NORMAL_TRACTION;
    const blendFactor = 1 - Math.exp(-traction * dt);
    this.vx += (desiredVx - this.vx) * blendFactor;
    this.vy += (desiredVy - this.vy) * blendFactor;
    this.vz += (desiredVz - this.vz) * blendFactor;

    // Apply gravity tangent (the component of gravity in the surface plane)
    if (isWallLike) {
      const gTan = getGravityTangent(this.surfaceNormal);
      this.vx += gTan.x * dt;
      this.vy += gTan.y * dt;
      this.vz += gTan.z * dt;
    }

    // Speed management
    let speed3d = Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);

    if (isFloorLike) {
      // On floor-like surfaces: renormalize to constant speed
      if (speed3d > 0.001) {
        this.vx = (this.vx / speed3d) * currentSpeed;
        this.vy = (this.vy / speed3d) * currentSpeed;
        this.vz = (this.vz / speed3d) * currentSpeed;
        speed3d = currentSpeed;
      }
    } else {
      // On wall-like surfaces: gravity affects speed, but clamp
      if (speed3d > WALL_MAX_SPEED) {
        const scale = WALL_MAX_SPEED / speed3d;
        this.vx *= scale; this.vy *= scale; this.vz *= scale;
        speed3d = WALL_MAX_SPEED;
      }
      if (speed3d < WALL_MIN_SPEED) {
        this.detachFromSurface();
        return;
      }
    }

    // Save old position for trail collision
    const oldPos: Vec2 = { x: this.position.x, z: this.position.z };

    // Move
    this.position.x += this.vx * dt;
    this.position.y += this.vy * dt;
    this.position.z += this.vz * dt;

    // Constrain position to arena surface
    const newSurfInfo = getArenaSurfaceInfo(this.position);
    this.position = { ...newSurfInfo.constrainedPos };
    this.surfaceNormal = newSurfInfo.normal;
    this.surfaceType = newSurfInfo.surfaceType;
    isFloorLike = this.surfaceNormal.y > 0.7;
    isWallLike = !isFloorLike;

    // Update forward from velocity (projected onto new surface plane)
    // Skip during drift so heading can diverge from velocity direction
    if (!this.drifting) {
      const projVel = projectOntoSurfacePlane(
        { x: this.vx, y: this.vy, z: this.vz },
        this.surfaceNormal,
      );
      if (projVel.x !== 0 || projVel.y !== 0 || projVel.z !== 0) {
        this.forward = projVel;
      }
    }

    // Project velocity onto the surface plane (remove any normal component from constraint)
    const velDotN = this.vx * this.surfaceNormal.x + this.vy * this.surfaceNormal.y + this.vz * this.surfaceNormal.z;
    this.vx -= velDotN * this.surfaceNormal.x;
    this.vy -= velDotN * this.surfaceNormal.y;
    this.vz -= velDotN * this.surfaceNormal.z;

    // Ceiling bounce: if constrained position is at ceiling, bounce off
    if (this.position.y >= CEILING_HEIGHT - 0.5 && this.surfaceNormal.y < -0.5) {
      this.bounceOffCeiling();
      return;
    }

    // Jump from any surface
    if (input.jump && this.jumpCooldown <= 0) {
      this.vx += this.surfaceNormal.x * JUMP_INITIAL_VY;
      this.vy += this.surfaceNormal.y * JUMP_INITIAL_VY;
      this.vz += this.surfaceNormal.z * JUMP_INITIAL_VY;
      this.onSurface = false;
      this.grounded = false;
      this.jumpCooldown = JUMP_COOLDOWN;
      this.usedDoubleJumpThisAirborne = false;
      this.surfaceType = SurfaceType.Air;
      this.drifting = false;
      this.driftTimer = 0;
      return;
    }

    // Check if bike is moving off-surface (e.g., going off the edge of the ramp zone)
    // This happens if canWallDrive is false and the surface becomes wall-like
    if (!this.canWallDrive && isWallLike) {
      this.detachFromSurface();
      return;
    }

    const newPos: Vec2 = { x: this.position.x, z: this.position.z };

    // Trail collision: use wall-plane projection when on a wall
    if (!skipCollision) {
      if (isWallLike) {
        this.checkTrailCollisionWall(dt, allTrails);
      } else {
        this.checkTrailCollisionFloor(oldPos, newPos, allTrails);
      }
      if (!this.alive) return;
    }
  }

  // ─── Air Physics ──────────────────────────────────────────────────────────

  private updateAir(dt: number, input: PlayerInput, allTrails: SimTrail[], skipCollision: boolean): void {
    this.drifting = false;
    this.driftTimer = 0;
    this.flying = this.boosting;

    // Steering (XZ plane only while airborne)
    const turnRate = this.flying ? TURN_RATE * FLIGHT_AIR_TURN_MULT : TURN_RATE;
    if (input.left) this.angle += turnRate * dt;
    if (input.right) this.angle -= turnRate * dt;
    this.forward = { x: Math.sin(this.angle), y: 0, z: Math.cos(this.angle) };

    // Pitch (only when airborne)
    if (input.pitchUp) {
      this.pitch = Math.min(FLIGHT_MAX_PITCH, this.pitch + FLIGHT_PITCH_RATE * dt);
    } else if (input.pitchDown) {
      this.pitch = Math.max(-FLIGHT_MAX_PITCH, this.pitch - FLIGHT_PITCH_RATE * dt);
    }

    const currentSpeed = this.speed * (this.boosting ? BOOST_MULTIPLIER : 1.0);

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

    // Floor landing
    if (this.position.y <= 0) {
      if (this.pitch > FLIGHT_LANDING_MAX_PITCH || this.pitch < -FLIGHT_MAX_PITCH * 0.9) {
        this.die();
        return;
      }
      this.position.y = 0;
      this.vy = 0;
      this.grounded = true;
      this.pitch = 0;
      this.flying = false;
      this.onSurface = true;
      this.surfaceType = SurfaceType.Floor;
      this.surfaceNormal = { x: 0, y: 1, z: 0 };
      this.jumpCooldown = JUMP_COOLDOWN;
    }

    const newPos: Vec2 = { x: this.position.x, z: this.position.z };

    // Wall boundary: always check (physics constraint, not trail collision)
    if (checkWallCollision(this.position.x, this.position.z)) {
      if (this.invulnerable) {
        this.position.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.x));
        this.position.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.z));
      } else if (this.position.y > 0 && this.canWallDrive) {
        this.attachToSurface();
      } else if (this.position.y > 0) {
        this.bounceOffWall();
      } else if (!skipCollision) {
        this.die();
        return;
      } else {
        // Predicted bike at ground level near wall: clamp (server authoritative for death)
        this.position.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.x));
        this.position.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.z));
      }
    }

    // Trail collision (skipped for predicted bikes — server authoritative)
    if (!skipCollision) {
      this.checkTrailCollisionFloor(oldPos, newPos, allTrails);
      if (!this.alive) return;
    }
  }

  // ─── Surface Transitions ─────────────────────────────────────────────────

  private attachToSurface(): void {
    const surfInfo = getArenaSurfaceInfo(this.position);
    this.position = { ...surfInfo.constrainedPos };
    this.surfaceNormal = surfInfo.normal;
    this.surfaceType = surfInfo.surfaceType;

    // Remove velocity component into the surface, keep tangential
    const velDotN = this.vx * this.surfaceNormal.x + this.vy * this.surfaceNormal.y + this.vz * this.surfaceNormal.z;
    // The component going INTO the surface (negative dot product) becomes "forward" momentum
    const intoSurfaceSpeed = Math.abs(Math.min(0, velDotN));
    this.vx -= velDotN * this.surfaceNormal.x;
    this.vy -= velDotN * this.surfaceNormal.y;
    this.vz -= velDotN * this.surfaceNormal.z;

    // Check we had enough velocity toward the surface
    if (intoSurfaceSpeed < WALL_ATTACH_MIN_VEL) {
      // Not enough speed -- just clamp position and stay airborne
      this.position.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.x));
      this.position.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.z));
      return;
    }

    // Add the toward-surface speed as additional tangential speed (upward on wall)
    // Determine "up" on the surface: the component of world-up projected onto surface plane
    const worldUpProj = projectOntoSurfacePlane({ x: 0, y: 1, z: 0 }, this.surfaceNormal);
    if (worldUpProj.x !== 0 || worldUpProj.y !== 0 || worldUpProj.z !== 0) {
      this.vx += worldUpProj.x * intoSurfaceSpeed;
      this.vy += worldUpProj.y * intoSurfaceSpeed;
      this.vz += worldUpProj.z * intoSurfaceSpeed;
    }

    // Update forward from velocity
    const projVel = projectOntoSurfacePlane(
      { x: this.vx, y: this.vy, z: this.vz },
      this.surfaceNormal,
    );
    if (projVel.x !== 0 || projVel.y !== 0 || projVel.z !== 0) {
      this.forward = projVel;
    }

    this.onSurface = true;
    this.grounded = true;
    this.pitch = 0;
    this.flying = false;
  }

  private detachFromSurface(): void {
    this.onSurface = false;
    this.grounded = false;
    this.surfaceType = SurfaceType.Air;
    this.surfaceNormal = { x: 0, y: 1, z: 0 };
    this.angle = Math.atan2(this.forward.x, this.forward.z);
  }

  private bounceOffCeiling(): void {
    this.position.y = CEILING_HEIGHT - 0.1;
    this.vy = -Math.abs(this.vy) * CEILING_RESTITUTION;

    if (this.onSurface) {
      this.detachFromSurface();
    }
  }

  private bounceOffWall(): void {
    // Reflect velocity component perpendicular to wall
    const surfInfo = getArenaSurfaceInfo(this.position);
    const n = surfInfo.normal;
    const velDotN = this.vx * n.x + this.vy * n.y + this.vz * n.z;
    // Only reflect if moving into the wall (velDotN < 0 means into wall since normal points inward)
    if (velDotN < 0) {
      // Apply restitution only to the normal component, preserve tangential speed
      const normalScale = -(1 + CEILING_RESTITUTION) * velDotN;
      this.vx += normalScale * n.x;
      this.vy += normalScale * n.y;
      this.vz += normalScale * n.z;
    }
    // Clamp position inside arena
    this.position.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.x));
    this.position.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.z));
  }

  // ─── Common Helpers ──────────────────────────────────────────────────────

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

  private checkTrailCollisionWall(dt: number, allTrails: SimTrail[]): void {
    const oldPos3D: Vec3 = {
      x: this.position.x - this.vx * dt,
      y: this.position.y - this.vy * dt,
      z: this.position.z - this.vz * dt,
    };
    const hit = checkTrailCollisionOnWall(oldPos3D, this.position, this.surfaceType, allTrails, this.playerIndex);
    if (!hit) return;

    if (this.invulnerable && hit.trailIndex !== this.playerIndex) {
      allTrails[hit.trailIndex].deleteSegmentsInRadius(hit.contactX, hit.contactZ, TRAIL_DESTROY_RADIUS);
      this.lastTrailDestruction = hit;
    } else if (!this.invulnerable) {
      this.die();
    }
  }

  private checkTrailCollisionFloor(oldPos: Vec2, newPos: Vec2, allTrails: SimTrail[]): void {
    const hit = checkTrailCollisionDetailed(oldPos, newPos, this.position.y, allTrails, this.playerIndex);
    if (!hit) return;

    if (this.invulnerable && hit.trailIndex !== this.playerIndex) {
      allTrails[hit.trailIndex].deleteSegmentsInRadius(hit.contactX, hit.contactZ, TRAIL_DESTROY_RADIUS);
      this.lastTrailDestruction = hit;
    } else if (!this.invulnerable) {
      this.die();
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

  /** Snap all physics state from a server snapshot (used for client-side reconciliation). */
  applyServerState(state: {
    x: number; y: number; z: number; angle: number;
    vx: number; vz: number; vy: number;
    alive: boolean; grounded: boolean;
    boosting: boolean; boostMeter: number;
    drifting: boolean; velocityAngle: number;
    pitch: number; flying: boolean;
    surfaceType: number;
    forwardX: number; forwardY: number; forwardZ: number;
    doubleJumpCooldown: number;
    invulnerable: boolean; invulnerableTimer: number;
  }): void {
    this.position.x = state.x;
    this.position.y = state.y;
    this.position.z = state.z;
    this.angle = state.angle;
    this.vx = state.vx;
    this.vz = state.vz;
    this.vy = state.vy;
    this.alive = state.alive;
    this.grounded = state.grounded;
    this.boosting = state.boosting;
    this.boostMeter = state.boostMeter;
    this.drifting = state.drifting;
    this.velocityAngle = state.velocityAngle;
    this.pitch = state.pitch;
    this.flying = state.flying;
    this.surfaceType = state.surfaceType as SurfaceType;
    this.forward = { x: state.forwardX, y: state.forwardY, z: state.forwardZ };
    this.doubleJumpCooldown = state.doubleJumpCooldown;
    this.doubleJumpReady = state.doubleJumpCooldown <= 0;

    // Derive surface state from position
    const surfInfo = getArenaSurfaceInfo(this.position);
    this.surfaceNormal = surfInfo.normal;
    this.onSurface = this.surfaceType !== SurfaceType.Air;

    // Sync invulnerability effect
    if (state.invulnerable && !this.invulnerable) {
      this.grantInvulnerability();
      this.effectTimer = state.invulnerableTimer;
    } else if (!state.invulnerable && this.invulnerable) {
      const effect = this.activeEffect;
      this.activeEffect = null;
      effect?.onExpire(this);
    } else if (state.invulnerable) {
      this.effectTimer = state.invulnerableTimer;
    }
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
    this.onSurface = true;
    this.surfaceType = SurfaceType.Floor;
    this.surfaceNormal = { x: 0, y: 1, z: 0 };
    this.forward = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
    this.trail.reset();
  }
}
