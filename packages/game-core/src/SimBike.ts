import type { Vec2, Vec3, PlayerInput, Quat } from '@tron/shared';
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
  WALL_GRAVITY, BOUNCE_DAMPING, SURFACE_ATTACH_MAX_ANGLE, CURVE_RADIUS,
} from '@tron/shared';
import {
  quatIdentity, quatFromAxisAngle, quatMultiply, quatNormalize,
  quatRotateVec3, quatFromBasis, quatToYawAngle,
  vec3Add, vec3Sub, vec3Scale, vec3Dot, vec3Cross, vec3Normalize,
  vec3Length, vec3LengthSq, vec3ProjectOnPlane, vec3Reflect,
} from '@tron/shared';
import { computeSurfaceInfo, snapToSurface, isDrivable, SurfaceId } from '@tron/shared';
import { SimTrail } from './SimTrail';
import { checkTrailCollision, checkTrailCollisionDetailed, type TrailHitInfo } from './Collision';
import type { SimPowerUpEffect } from './powerups/SimPowerUpEffect';
import { createSimEffect } from './powerups/SimPowerUpRegistry';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function isCurve(surfaceId: SurfaceId): boolean {
  return surfaceId === SurfaceId.CURVE_PX
    || surfaceId === SurfaceId.CURVE_NX
    || surfaceId === SurfaceId.CURVE_PZ
    || surfaceId === SurfaceId.CURVE_NZ;
}

export class SimBike {
  position: Vec3;
  orientation: Quat;
  surfaceNormal: Vec3 = { x: 0, y: 1, z: 0 };
  surfaceId: SurfaceId = SurfaceId.FLOOR;
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

  // 3D velocity vector (surface-tangent when grounded, world-space when airborne)
  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  // Airborne velocity (world-space, includes gravity)
  airborneVelocity: Vec3 = { x: 0, y: 0, z: 0 };

  /** angle getter: derived from orientation for backwards compatibility */
  get angle(): number {
    return quatToYawAngle(this.orientation);
  }

  /** angle setter: FLOOR-ONLY init (reset/spawn/constructor). Never use for steering! */
  set angle(v: number) {
    this.orientation = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, v);
    this.surfaceNormal = { x: 0, y: 1, z: 0 };
    this.surfaceId = SurfaceId.FLOOR;
  }

  constructor(playerIndex: number, color: string, x: number, z: number, angle: number) {
    this.playerIndex = playerIndex;
    this.color = color;
    this.position = { x, y: 0, z };
    this.orientation = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, angle);
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

    // Steering — quaternion rotation around surface normal (constraint #1)
    const turnRate = this.drifting ? TURN_RATE * DRIFT_TURN_MULTIPLIER
      : this.flying ? TURN_RATE * FLIGHT_AIR_TURN_MULT
      : TURN_RATE;
    if (input.left) {
      this.orientation = quatNormalize(quatMultiply(
        quatFromAxisAngle(this.surfaceNormal, turnRate * dt),
        this.orientation,
      ));
    }
    if (input.right) {
      this.orientation = quatNormalize(quatMultiply(
        quatFromAxisAngle(this.surfaceNormal, -turnRate * dt),
        this.orientation,
      ));
    }

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

    const forward = quatRotateVec3(this.orientation, { x: 0, y: 0, z: 1 });

    const oldPos: Vec3 = { x: this.position.x, y: this.position.y, z: this.position.z };

    if (this.grounded) {
      // --- Grounded movement with traction blend ---
      let desiredVelocity = vec3Scale(forward, currentSpeed);

      // Wall gravity: bias desired direction downward on non-floor surfaces (constraint #5)
      if (this.surfaceId !== SurfaceId.FLOOR) {
        const gravityBias = vec3ProjectOnPlane({ x: 0, y: -WALL_GRAVITY * dt, z: 0 }, this.surfaceNormal);
        desiredVelocity = vec3Add(desiredVelocity, gravityBias);
      }

      // Traction blend (same exponential model as before)
      const traction = this.drifting ? DRIFT_TRACTION : NORMAL_TRACTION;
      const blendFactor = 1 - Math.exp(-traction * dt);
      this.velocity = vec3Add(this.velocity, vec3Scale(vec3Sub(desiredVelocity, this.velocity), blendFactor));

      // Re-project onto surface tangent (prevent drift away from surface)
      this.velocity = vec3ProjectOnPlane(this.velocity, this.surfaceNormal);

      // Renormalize to currentSpeed only on floor; on walls, allow gravity to affect speed
      if (this.surfaceId === SurfaceId.FLOOR) {
        const len = vec3Length(this.velocity);
        if (len > 0.001) {
          this.velocity = vec3Scale(vec3Normalize(this.velocity), currentSpeed);
        }
      } else {
        let spd = vec3Length(this.velocity);
        spd = clamp(spd, currentSpeed * 0.5, currentSpeed * 1.3);
        const vn = vec3Normalize(this.velocity);
        if (vec3LengthSq(vn) > 0.001) {
          this.velocity = vec3Scale(vn, spd);
        }
      }

      // Derive vx/vz/velocityAngle for backwards compatibility
      this.vx = this.velocity.x;
      this.vz = this.velocity.z;
      this.velocityAngle = Math.atan2(this.velocity.x, this.velocity.z);

      // Move along surface
      this.position = vec3Add(this.position, vec3Scale(this.velocity, dt));

      // Jump: launch perpendicular to surface
      this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
      if (input.jump && this.jumpCooldown <= 0) {
        this.airborneVelocity = vec3Add(this.velocity, vec3Scale(this.surfaceNormal, JUMP_INITIAL_VY));
        this.vy = this.airborneVelocity.y;
        this.grounded = false;
        this.jumpCooldown = JUMP_COOLDOWN;
        this.usedDoubleJumpThisAirborne = false;
        // Cancel drift on jump
        if (this.drifting) {
          this.drifting = false;
          this.driftTimer = 0;
        }
      }

      // Surface tracking after movement
      if (this.grounded) {
        const info = computeSurfaceInfo(this.position);

        // Check for wall-to-wall corners: detach and go airborne
        if (this.surfaceId !== SurfaceId.FLOOR && info.surfaceId !== this.surfaceId) {
          const isWallToWall = isDrivable(this.surfaceId) && isDrivable(info.surfaceId)
            && (info.surfaceId as SurfaceId) !== SurfaceId.FLOOR
            && !isCurve(this.surfaceId) && !isCurve(info.surfaceId);

          if (isWallToWall) {
            // Detach: go airborne at vertical corners
            this.grounded = false;
            this.airborneVelocity = { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z };
            this.vy = this.airborneVelocity.y;
          } else if (info.drivable) {
            this.transitionToSurface(info);
          } else {
            // Hit non-drivable surface while grounded — detach
            this.grounded = false;
            this.airborneVelocity = { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z };
            this.vy = this.airborneVelocity.y;
          }
        } else if (info.drivable) {
          this.position = snapToSurface(this.position, info);
          this.surfaceNormal = info.normal;
          this.surfaceId = info.surfaceId;
          this.reorthogonalizeOrientation(info.normal);
        }
      }
    } else {
      // --- Airborne physics ---
      if (this.flying) {
        const horizSpeed = BIKE_SPEED * BOOST_MULTIPLIER * Math.cos(this.pitch);
        const fwdXZ = { x: forward.x, y: 0, z: forward.z };
        const fwdXZn = vec3Normalize(fwdXZ);
        if (vec3LengthSq(fwdXZn) > 0.001) {
          this.airborneVelocity.x = fwdXZn.x * horizSpeed;
          this.airborneVelocity.z = fwdXZn.z * horizSpeed;
        }
        this.airborneVelocity.y += FLIGHT_THRUST * Math.sin(this.pitch) * dt;
      } else if (this.pitch > 0) {
        const horizSpeed = BIKE_SPEED * Math.cos(this.pitch);
        const fwdXZ = { x: forward.x, y: 0, z: forward.z };
        const fwdXZn = vec3Normalize(fwdXZ);
        if (vec3LengthSq(fwdXZn) > 0.001) {
          this.airborneVelocity.x = fwdXZn.x * horizSpeed;
          this.airborneVelocity.z = fwdXZn.z * horizSpeed;
        }
      }

      // Double jump
      this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
      if (input.jump && this.jumpCooldown <= 0 && this.doubleJumpReady && !this.usedDoubleJumpThisAirborne) {
        this.airborneVelocity.y = JUMP_INITIAL_VY;
        this.usedDoubleJumpThisAirborne = true;
        this.doubleJumpReady = false;
        this.doubleJumpCooldown = DOUBLE_JUMP_COOLDOWN;
        this.jumpCooldown = JUMP_COOLDOWN;
      }

      // World gravity
      this.airborneVelocity.y -= GRAVITY * dt;

      // Move
      this.position = vec3Add(this.position, vec3Scale(this.airborneVelocity, dt));
      this.vy = this.airborneVelocity.y;

      // Derive vx/vz for compatibility
      this.vx = this.airborneVelocity.x;
      this.vz = this.airborneVelocity.z;
      this.velocityAngle = Math.atan2(this.airborneVelocity.x, this.airborneVelocity.z);

      // Check surface contact
      const info = computeSurfaceInfo(this.position);
      if (info.distance <= 0) {
        if (info.drivable) {
          const velDir = vec3Normalize(this.airborneVelocity);
          const approachDot = Math.abs(vec3Dot(velDir, info.normal));

          if (approachDot < SURFACE_ATTACH_MAX_ANGLE) {
            // Attach: shallow approach, land on surface
            if (this.pitch > FLIGHT_LANDING_MAX_PITCH) {
              this.die();
              return;
            }

            this.position = snapToSurface(this.position, info);
            this.velocity = vec3ProjectOnPlane(this.airborneVelocity, info.normal);
            this.surfaceNormal = info.normal;
            this.surfaceId = info.surfaceId;
            this.grounded = true;
            this.vy = 0;
            this.pitch = 0;
            this.flying = false;
            this.jumpCooldown = JUMP_COOLDOWN;
            this.reorthogonalizeOrientation(info.normal);
          } else {
            // Bounce: steep approach
            this.airborneVelocity = vec3Scale(
              vec3Reflect(this.airborneVelocity, info.normal),
              BOUNCE_DAMPING,
            );
            this.vy = this.airborneVelocity.y;
            this.position = snapToSurface(this.position, info);
            this.position = vec3Add(this.position, vec3Scale(info.normal, 0.1));
          }
        } else {
          // Non-drivable surface (ceiling, corners): always bounce
          this.airborneVelocity = vec3Scale(
            vec3Reflect(this.airborneVelocity, info.normal),
            BOUNCE_DAMPING,
          );
          this.vy = this.airborneVelocity.y;
          this.position = snapToSurface(this.position, info);
          this.position = vec3Add(this.position, vec3Scale(info.normal, 0.1));
        }
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
      // Boundary check — clamp to arena if invulnerable
      if (Math.abs(this.position.x) > ARENA_HALF + 1 || Math.abs(this.position.z) > ARENA_HALF + 1) {
        if (this.invulnerable) {
          this.position = {
            x: clamp(this.position.x, -ARENA_HALF, ARENA_HALF),
            y: this.position.y,
            z: clamp(this.position.z, -ARENA_HALF, ARENA_HALF),
          };
        } else {
          this.die();
          return;
        }
      }

      // Trail collision
      const oldPos2d: Vec2 = { x: oldPos.x, z: oldPos.z };
      if (this.invulnerable) {
        const hit = checkTrailCollisionDetailed(oldPos2d, newPos, this.position.y, allTrails, this.playerIndex);
        if (hit && hit.trailIndex !== this.playerIndex) {
          allTrails[hit.trailIndex].deleteSegmentsInRadius(hit.contactX, hit.contactZ, TRAIL_DESTROY_RADIUS);
          this.lastTrailDestruction = hit;
        }
      } else {
        if (checkTrailCollision(oldPos2d, newPos, this.position.y, allTrails, this.playerIndex)) {
          this.die();
          return;
        }
      }
    }

    // Update trail
    this.trail.addPoint(this.position.x, this.position.y, this.position.z);
  }

  /** Re-orthogonalize orientation to align with new surface normal (constraint #3). */
  private reorthogonalizeOrientation(newNormal: Vec3): void {
    let fwd = quatRotateVec3(this.orientation, { x: 0, y: 0, z: 1 });
    let projected = vec3ProjectOnPlane(fwd, newNormal);

    // Constraint #3: If forward is parallel to surface normal, projection is zero
    if (vec3LengthSq(projected) < 0.001) {
      const velN = vec3Normalize(this.velocity);
      projected = vec3ProjectOnPlane(velN, newNormal);
    }
    if (vec3LengthSq(projected) < 0.001) {
      const right = quatRotateVec3(this.orientation, { x: 1, y: 0, z: 0 });
      projected = vec3Cross(newNormal, right);
    }
    if (vec3LengthSq(projected) < 0.001) {
      projected = vec3ProjectOnPlane({ x: 0, y: 0, z: 1 }, newNormal);
    }

    fwd = vec3Normalize(projected);
    const right = vec3Normalize(vec3Cross(fwd, newNormal));
    this.orientation = quatNormalize(quatFromBasis(right, newNormal, fwd));
  }

  private transitionToSurface(info: ReturnType<typeof computeSurfaceInfo>): void {
    this.position = snapToSurface(this.position, info);
    this.surfaceNormal = info.normal;
    this.surfaceId = info.surfaceId;
    this.velocity = vec3ProjectOnPlane(this.velocity, info.normal);
    this.reorthogonalizeOrientation(info.normal);
  }

  grantInvulnerability(): void {
    createSimEffect('invulnerability')?.onGrant(this);
  }

  private initVelocity(angle: number): void {
    this.velocityAngle = angle;
    this.vx = Math.sin(angle) * BIKE_SPEED;
    this.vz = Math.cos(angle) * BIKE_SPEED;
    this.velocity = { x: this.vx, y: 0, z: this.vz };
  }

  private die(): void {
    this.alive = false;
    const effect = this.activeEffect;
    this.activeEffect = null;
    effect?.onExpire(this);
  }

  reset(x: number, z: number, angle: number): void {
    this.position = { x, y: 0, z };
    this.orientation = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, angle);
    this.surfaceNormal = { x: 0, y: 1, z: 0 };
    this.surfaceId = SurfaceId.FLOOR;
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
    this.velocity = { x: this.vx, y: 0, z: this.vz };
    this.airborneVelocity = { x: 0, y: 0, z: 0 };
    this.trail.reset();
  }
}
