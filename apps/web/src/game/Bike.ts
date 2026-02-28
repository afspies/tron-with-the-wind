import * as THREE from 'three';
import {
  BIKE_SPEED, TURN_RATE,
  JUMP_INITIAL_VY, GRAVITY, JUMP_COOLDOWN,
  BOOST_MULTIPLIER, BOOST_MAX, BOOST_DRAIN, BOOST_RECHARGE, BOOST_RECHARGE_DELAY,
  NET_TICK_DURATION_MS, VISUAL_CORRECTION_RATE,
  RENDER_OFFSET_SNAP_THRESHOLD, RENDER_OFFSET_MIN_CORRECTION,
  ARENA_HALF, TRAIL_DESTROY_RADIUS,
  DOUBLE_JUMP_COOLDOWN,
  DRIFT_TURN_MULTIPLIER, DRIFT_SPEED_MULTIPLIER, DRIFT_TRACTION, NORMAL_TRACTION,
  FLIGHT_PITCH_RATE, FLIGHT_MAX_PITCH,
  FLIGHT_THRUST, FLIGHT_AIR_TURN_MULT, FLIGHT_BOOST_DRAIN_MULT,
  FLIGHT_LANDING_MAX_PITCH,
  WALL_GRAVITY, BOUNCE_DAMPING, SURFACE_ATTACH_MAX_ANGLE,
} from '@tron/shared';
import type { Vec2, Vec3, Quat, PlayerInput } from '@tron/shared';
import {
  quatIdentity, quatFromAxisAngle, quatMultiply, quatNormalize, quatInverse,
  quatRotateVec3, quatFromBasis, quatToYawAngle, quatSlerp, quatDot,
  vec3Add, vec3Sub, vec3Scale, vec3Dot, vec3Cross, vec3Normalize,
  vec3Length, vec3LengthSq, vec3ProjectOnPlane, vec3Reflect,
} from '@tron/shared';
import { computeSurfaceInfo, snapToSurface, isDrivable, SurfaceId } from '@tron/shared';
import type { SimBike } from '@tron/game-core';
import { Trail } from './Trail';
import { checkTrailCollision, checkTrailCollisionDetailed } from './Collision';
import type { PowerUpEffect } from './powerups/PowerUpEffect';
import { createEffect } from './powerups/PowerUpRegistry';
import { TrailParticles, DriftParticles, DeathParticles } from './BikeParticles';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function isCurve(surfaceId: SurfaceId): boolean {
  return surfaceId === SurfaceId.CURVE_PX
    || surfaceId === SurfaceId.CURVE_NX
    || surfaceId === SurfaceId.CURVE_PZ
    || surfaceId === SurfaceId.CURVE_NZ;
}

export class Bike {
  mesh: THREE.Group;
  trail: Trail;
  position: THREE.Vector3;
  speed: number;
  vy = 0;
  alive = true;
  grounded = true;
  jumpCooldown = 0;
  boostMeter = BOOST_MAX;
  boosting = false;
  playerIndex: number;
  color: string;

  // Quaternion orientation + surface tracking
  orientationQuat: Quat;
  surfaceNormal: Vec3 = { x: 0, y: 1, z: 0 };
  surfaceId: SurfaceId = SurfaceId.FLOOR;
  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  airborneVelocity: Vec3 = { x: 0, y: 0, z: 0 };

  /** angle getter: derived from orientation for backwards compatibility */
  get angle(): number {
    return quatToYawAngle(this.orientationQuat);
  }

  /** angle setter: FLOOR-ONLY init (reset/spawn). Never use for steering! */
  set angle(v: number) {
    this.orientationQuat = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, v);
    this.surfaceNormal = { x: 0, y: 1, z: 0 };
    this.surfaceId = SurfaceId.FLOOR;
  }

  // Generic effect slot
  activeEffect: PowerUpEffect | null = null;
  effectTimer = 0;

  get invulnerable(): boolean {
    return this.activeEffect?.type === 'invulnerability' && this.effectTimer > 0;
  }
  get invulnerableTimer(): number {
    return this.invulnerable ? this.effectTimer : 0;
  }

  lastTrailDestruction: { trailIndex: number; contactX: number; contactZ: number } | null = null;

  // Double jump
  doubleJumpReady = true;
  doubleJumpCooldown = 0;
  usedDoubleJumpThisAirborne = false;

  // Boost recharge delay
  boostRechargeTimer = 0;

  // Drift
  drifting = false;
  velocityAngle: number = 0;
  driftTimer = 0;
  vx = 0;
  vz = 0;

  // Flight
  pitch = 0;
  flying = false;

  // Client-side prediction
  isLocalPredicted = false;

  // Render offset: position + quaternion offsets that decay smoothly
  renderOffset = new THREE.Vector3();
  renderQuatOffset: Quat = quatIdentity();

  // Rendered position/orientation
  visualPos: THREE.Vector3;
  visualAngle: number;
  private visualInitialized = false;

  private netBuffer: Array<{
    x: number; z: number; y: number;
    qx: number; qy: number; qz: number; qw: number;
    surfaceId: number;
    vy: number; grounded: boolean;
    pitch: number; flying: boolean;
    tick: number; time: number;
  }> = [];
  private bodyMesh: THREE.Mesh;
  private bikeLight: THREE.PointLight;
  private scene: THREE.Scene;

  // Particles
  private trailParticles: TrailParticles;
  private driftParticles: DriftParticles;
  private deathParticles: DeathParticles | null = null;

  constructor(
    playerIndex: number,
    color: string,
    x: number,
    z: number,
    angle: number,
    scene: THREE.Scene,
  ) {
    this.playerIndex = playerIndex;
    this.color = color;
    this.position = new THREE.Vector3(x, 0, z);
    this.orientationQuat = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, angle);
    this.velocityAngle = angle;
    this.speed = BIKE_SPEED;
    this.initVelocity(angle);
    this.visualPos = this.position.clone();
    this.visualAngle = angle;
    this.scene = scene;

    // Build bike mesh
    this.mesh = new THREE.Group();

    // Main body
    const bodyGeo = new THREE.BoxGeometry(0.8, 0.6, 2.0);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.3,
      metalness: 0.6,
      roughness: 0.3,
    });
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.bodyMesh.position.y = 0.5;
    this.mesh.add(this.bodyMesh);

    // Windshield
    const shieldGeo = new THREE.BoxGeometry(0.6, 0.5, 0.3);
    const shieldMat = new THREE.MeshStandardMaterial({
      color: 0xaaddff,
      transparent: true,
      opacity: 0.5,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.2,
    });
    const shield = new THREE.Mesh(shieldGeo, shieldMat);
    shield.position.set(0, 0.9, -0.5);
    this.mesh.add(shield);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 8);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });

    const frontWheel = new THREE.Mesh(wheelGeo, wheelMat);
    frontWheel.rotation.z = Math.PI / 2;
    frontWheel.position.set(0, 0.3, -0.8);
    this.mesh.add(frontWheel);

    const rearWheel = new THREE.Mesh(wheelGeo, wheelMat);
    rearWheel.rotation.z = Math.PI / 2;
    rearWheel.position.set(0, 0.3, 0.8);
    this.mesh.add(rearWheel);

    // Bike glow point light
    this.bikeLight = new THREE.PointLight(new THREE.Color(color), 2, 15);
    this.bikeLight.position.set(0, 1, 0);
    this.mesh.add(this.bikeLight);

    this.mesh.position.copy(this.position);
    this.mesh.quaternion.set(
      this.orientationQuat.x, this.orientationQuat.y,
      this.orientationQuat.z, this.orientationQuat.w,
    );
    scene.add(this.mesh);

    // Trail
    this.trail = new Trail(color, scene);

    // Particles
    this.trailParticles = new TrailParticles(color, scene);
    this.driftParticles = new DriftParticles(color, scene);
  }

  update(dt: number, input: PlayerInput, allTrails: Trail[], skipCollision = false): void {
    if (!this.alive) {
      this.deathParticles?.update(dt);
      return;
    }

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
      this.orientationQuat = quatNormalize(quatMultiply(
        quatFromAxisAngle(this.surfaceNormal, turnRate * dt),
        this.orientationQuat,
      ));
    }
    if (input.right) {
      this.orientationQuat = quatNormalize(quatMultiply(
        quatFromAxisAngle(this.surfaceNormal, -turnRate * dt),
        this.orientationQuat,
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

    const forward = quatRotateVec3(this.orientationQuat, { x: 0, y: 0, z: 1 });
    const oldPos: Vec3 = { x: this.position.x, y: this.position.y, z: this.position.z };

    if (this.grounded) {
      // --- Grounded movement with traction blend ---
      let desiredVelocity = vec3Scale(forward, currentSpeed);

      // Wall gravity: bias desired direction downward on non-floor surfaces (constraint #5)
      if (this.surfaceId !== SurfaceId.FLOOR) {
        const gravityBias = vec3ProjectOnPlane({ x: 0, y: -WALL_GRAVITY * dt, z: 0 }, this.surfaceNormal);
        desiredVelocity = vec3Add(desiredVelocity, gravityBias);
      }

      // Traction blend
      const traction = this.drifting ? DRIFT_TRACTION : NORMAL_TRACTION;
      const blendFactor = 1 - Math.exp(-traction * dt);
      this.velocity = vec3Add(this.velocity, vec3Scale(vec3Sub(desiredVelocity, this.velocity), blendFactor));

      // Re-project onto surface tangent
      this.velocity = vec3ProjectOnPlane(this.velocity, this.surfaceNormal);

      // Renormalize
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
      const move = vec3Scale(this.velocity, dt);
      this.position.x += move.x;
      this.position.y += move.y;
      this.position.z += move.z;

      // Jump: launch perpendicular to surface
      this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
      if (input.jump && this.jumpCooldown <= 0) {
        this.airborneVelocity = vec3Add(this.velocity, vec3Scale(this.surfaceNormal, JUMP_INITIAL_VY));
        this.vy = this.airborneVelocity.y;
        this.grounded = false;
        this.jumpCooldown = JUMP_COOLDOWN;
        this.usedDoubleJumpThisAirborne = false;
        if (this.drifting) {
          this.drifting = false;
          this.driftTimer = 0;
        }
      }

      // Surface tracking after movement
      if (this.grounded) {
        const pos: Vec3 = { x: this.position.x, y: this.position.y, z: this.position.z };
        const info = computeSurfaceInfo(pos);

        // Wall-to-wall corner: detach
        if (this.surfaceId !== SurfaceId.FLOOR && info.surfaceId !== this.surfaceId) {
          const isWallToWall = isDrivable(this.surfaceId) && isDrivable(info.surfaceId)
            && (info.surfaceId as SurfaceId) !== SurfaceId.FLOOR
            && !isCurve(this.surfaceId) && !isCurve(info.surfaceId);

          if (isWallToWall) {
            this.grounded = false;
            this.airborneVelocity = { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z };
            this.vy = this.airborneVelocity.y;
          } else if (info.drivable) {
            this.transitionToSurface(info);
          } else {
            this.grounded = false;
            this.airborneVelocity = { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z };
            this.vy = this.airborneVelocity.y;
          }
        } else if (info.drivable) {
          const snapped = snapToSurface(pos, info);
          this.position.set(snapped.x, snapped.y, snapped.z);
          this.surfaceNormal = info.normal;
          this.surfaceId = info.surfaceId;
          this.reorthogonalizeOrientation(info.normal);
        }
      }
    } else {
      // --- Airborne physics ---
      if (this.flying) {
        const horizSpeed = BIKE_SPEED * BOOST_MULTIPLIER * Math.cos(this.pitch);
        const fwdXZ = vec3Normalize({ x: forward.x, y: 0, z: forward.z });
        if (vec3LengthSq(fwdXZ) > 0.001) {
          this.airborneVelocity.x = fwdXZ.x * horizSpeed;
          this.airborneVelocity.z = fwdXZ.z * horizSpeed;
        }
        this.airborneVelocity.y += FLIGHT_THRUST * Math.sin(this.pitch) * dt;
      } else if (this.pitch > 0) {
        const horizSpeed = BIKE_SPEED * Math.cos(this.pitch);
        const fwdXZ = vec3Normalize({ x: forward.x, y: 0, z: forward.z });
        if (vec3LengthSq(fwdXZ) > 0.001) {
          this.airborneVelocity.x = fwdXZ.x * horizSpeed;
          this.airborneVelocity.z = fwdXZ.z * horizSpeed;
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
      this.position.x += this.airborneVelocity.x * dt;
      this.position.y += this.airborneVelocity.y * dt;
      this.position.z += this.airborneVelocity.z * dt;
      this.vy = this.airborneVelocity.y;

      // Derive vx/vz for compatibility
      this.vx = this.airborneVelocity.x;
      this.vz = this.airborneVelocity.z;
      this.velocityAngle = Math.atan2(this.airborneVelocity.x, this.airborneVelocity.z);

      // Check surface contact
      const pos: Vec3 = { x: this.position.x, y: this.position.y, z: this.position.z };
      const info = computeSurfaceInfo(pos);
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
            const snapped = snapToSurface(pos, info);
            this.position.set(snapped.x, snapped.y, snapped.z);
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
            const snapped = snapToSurface(pos, info);
            const pushed = vec3Add(snapped, vec3Scale(info.normal, 0.1));
            this.position.set(pushed.x, pushed.y, pushed.z);
          }
        } else {
          // Non-drivable surface: always bounce
          this.airborneVelocity = vec3Scale(
            vec3Reflect(this.airborneVelocity, info.normal),
            BOUNCE_DAMPING,
          );
          this.vy = this.airborneVelocity.y;
          const snapped = snapToSurface(pos, info);
          const pushed = vec3Add(snapped, vec3Scale(info.normal, 0.1));
          this.position.set(pushed.x, pushed.y, pushed.z);
        }
      }
    }

    const newPos: Vec2 = { x: this.position.x, z: this.position.z };

    // Active effect update
    if (this.activeEffect) {
      if (!this.activeEffect.onUpdate(this, dt)) {
        this.activeEffect.onExpire(this);
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

    // Collision (skipped for client-predicted bikes — host is authoritative for death)
    if (!skipCollision) {
      // Boundary check — out of arena
      if (Math.abs(this.position.x) > ARENA_HALF + 1 || Math.abs(this.position.z) > ARENA_HALF + 1) {
        if (this.invulnerable) {
          this.position.x = clamp(this.position.x, -ARENA_HALF, ARENA_HALF);
          this.position.z = clamp(this.position.z, -ARENA_HALF, ARENA_HALF);
        } else {
          this.die();
          return;
        }
      }

      if (this.invulnerable) {
        const hit = checkTrailCollisionDetailed(
          { x: oldPos.x, z: oldPos.z }, newPos, this.position.y, allTrails, this.playerIndex,
        );
        if (hit && hit.trailIndex !== this.playerIndex) {
          allTrails[hit.trailIndex].deleteSegmentsInRadius(hit.contactX, hit.contactZ, TRAIL_DESTROY_RADIUS);
          this.lastTrailDestruction = hit;
        }
      } else {
        if (checkTrailCollision({ x: oldPos.x, z: oldPos.z }, newPos, this.position.y, allTrails, this.playerIndex)) {
          this.die();
          return;
        }
      }
    }

    // Update trail
    this.trail.addPoint(this.position.x, this.position.y, this.position.z);

    // Predicted bikes: decay render offset so visual smoothly converges to physics
    if (this.isLocalPredicted) {
      const decayFactor = Math.exp(-VISUAL_CORRECTION_RATE * dt);
      this.renderOffset.multiplyScalar(decayFactor);
      this.renderQuatOffset = quatSlerp(this.renderQuatOffset, quatIdentity(), 1 - decayFactor);
      if (this.renderOffset.lengthSq() < 0.0001) this.renderOffset.set(0, 0, 0);
      if (Math.abs(1 - quatDot(this.renderQuatOffset, quatIdentity())) < 0.0001) {
        this.renderQuatOffset = quatIdentity();
      }
    }

    // Compute visual position and orientation
    this.visualPos.copy(this.position).add(this.renderOffset);
    const visualQuat = quatNormalize(quatMultiply(this.orientationQuat, this.renderQuatOffset));
    this.visualAngle = quatToYawAngle(visualQuat);
    this.visualInitialized = true;
    this.mesh.position.copy(this.visualPos);
    this.mesh.quaternion.set(visualQuat.x, visualQuat.y, visualQuat.z, visualQuat.w);

    this.updateBodyPitch();
    this.updateDriftLean();

    // Particles (pass forward/up for surface-aware emission)
    const pFwd = quatRotateVec3(this.orientationQuat, { x: 0, y: 0, z: 1 });
    const pUp = this.surfaceNormal;
    this.trailParticles.update(dt, this.visualPos.x, this.visualPos.y, this.visualPos.z, this.visualAngle, this.grounded, this.flying, pFwd, pUp);
    this.driftParticles.update(dt, this.visualPos.x, this.visualPos.y, this.visualPos.z, this.visualAngle, this.grounded, this.drifting, pFwd, pUp);
  }

  grantInvulnerability(): void {
    const effect = createEffect('invulnerability');
    if (effect) {
      effect.onGrant(this);
    }
  }

  /** Sync visual state from headless simulation bike (used in quickplay) */
  syncFromSim(simBike: SimBike, dt: number): void {
    // Handle death transition
    if (!simBike.alive && this.alive) {
      this.alive = false;
      this.mesh.visible = false;
      this.expireActiveEffect();
      this.deathParticles = new DeathParticles(
        this.color, simBike.position.x, simBike.position.y, simBike.position.z, this.scene,
        simBike.surfaceNormal,
      );
    }

    if (!this.alive) {
      this.deathParticles?.update(dt);
      return;
    }

    // Copy physics state
    this.position.set(simBike.position.x, simBike.position.y, simBike.position.z);
    this.orientationQuat = { ...simBike.orientation };
    this.surfaceNormal = { ...simBike.surfaceNormal };
    this.surfaceId = simBike.surfaceId;
    this.velocity = { ...simBike.velocity };
    this.airborneVelocity = { ...simBike.airborneVelocity };
    this.speed = simBike.speed;
    this.vy = simBike.vy;
    this.grounded = simBike.grounded;
    this.boosting = simBike.boosting;
    this.boostMeter = simBike.boostMeter;
    this.jumpCooldown = simBike.jumpCooldown;
    this.doubleJumpReady = simBike.doubleJumpReady;
    this.doubleJumpCooldown = simBike.doubleJumpCooldown;
    this.usedDoubleJumpThisAirborne = simBike.usedDoubleJumpThisAirborne;
    this.boostRechargeTimer = simBike.boostRechargeTimer;
    this.drifting = simBike.drifting;
    this.velocityAngle = simBike.velocityAngle;
    this.driftTimer = simBike.driftTimer;
    this.vx = simBike.vx;
    this.vz = simBike.vz;
    this.pitch = simBike.pitch;
    this.flying = simBike.flying;

    // Sync invulnerability visual effect
    this.syncInvulnerabilityFromNet(simBike.invulnerable, simBike.invulnerableTimer);

    // Update mesh with quaternion orientation
    this.visualPos.copy(this.position);
    this.visualAngle = this.angle;
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.set(
      this.orientationQuat.x, this.orientationQuat.y,
      this.orientationQuat.z, this.orientationQuat.w,
    );

    this.updateBodyPitch();
    this.updateDriftLean();

    // Sync trail from simulation
    this.trail.syncFromSimTrail(simBike.trail.points);

    // Update particles (pass forward/up for surface-aware emission)
    const sFwd = quatRotateVec3(this.orientationQuat, { x: 0, y: 0, z: 1 });
    const sUp = this.surfaceNormal;
    this.trailParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded, this.flying, sFwd, sUp);
    this.driftParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded, this.drifting, sFwd, sUp);

    // Effect visual update
    if (this.activeEffect) {
      this.activeEffect.onUpdate(this, dt);
    }
  }

  setBodyColor(color: THREE.Color, emissiveIntensity: number): void {
    const mat = this.bodyMesh.material as THREE.MeshStandardMaterial;
    mat.color.copy(color);
    mat.emissive.copy(color);
    mat.emissiveIntensity = emissiveIntensity;
  }

  setLightColor(color: THREE.Color, intensity: number): void {
    this.bikeLight.color.copy(color);
    this.bikeLight.intensity = intensity;
  }

  /** Effective speed accounting for boost and drift multipliers. */
  private get effectiveSpeed(): number {
    const boostMul = this.boosting ? BOOST_MULTIPLIER : 1.0;
    const driftMul = this.drifting ? DRIFT_SPEED_MULTIPLIER : 1.0;
    return this.speed * boostMul * driftMul;
  }

  private initVelocity(angle: number): void {
    this.velocityAngle = angle;
    this.vx = Math.sin(angle) * BIKE_SPEED;
    this.vz = Math.cos(angle) * BIKE_SPEED;
    this.velocity = { x: this.vx, y: 0, z: this.vz };
  }

  /** Re-orthogonalize orientation to align with new surface normal (constraint #3). */
  private reorthogonalizeOrientation(newNormal: Vec3): void {
    let fwd = quatRotateVec3(this.orientationQuat, { x: 0, y: 0, z: 1 });
    let projected = vec3ProjectOnPlane(fwd, newNormal);

    if (vec3LengthSq(projected) < 0.001) {
      const velN = vec3Normalize(this.velocity);
      projected = vec3ProjectOnPlane(velN, newNormal);
    }
    if (vec3LengthSq(projected) < 0.001) {
      const right = quatRotateVec3(this.orientationQuat, { x: 1, y: 0, z: 0 });
      projected = vec3Cross(newNormal, right);
    }
    if (vec3LengthSq(projected) < 0.001) {
      projected = vec3ProjectOnPlane({ x: 0, y: 0, z: 1 }, newNormal);
    }

    fwd = vec3Normalize(projected);
    const right = vec3Normalize(vec3Cross(newNormal, fwd));
    this.orientationQuat = quatNormalize(quatFromBasis(right, newNormal, fwd));
  }

  private transitionToSurface(info: ReturnType<typeof computeSurfaceInfo>): void {
    const snapped = snapToSurface(
      { x: this.position.x, y: this.position.y, z: this.position.z }, info,
    );
    this.position.set(snapped.x, snapped.y, snapped.z);
    this.surfaceNormal = info.normal;
    this.surfaceId = info.surfaceId;
    this.velocity = vec3ProjectOnPlane(this.velocity, info.normal);
    this.reorthogonalizeOrientation(info.normal);
  }

  private updateBodyPitch(): void {
    if (this.flying || this.pitch > 0.01) {
      this.bodyMesh.rotation.x = -this.pitch;
    } else if (!this.grounded) {
      this.bodyMesh.rotation.x = -(this.vy / JUMP_INITIAL_VY) * 0.2;
    } else {
      this.bodyMesh.rotation.x = 0;
    }
  }

  private updateDriftLean(): void {
    if (this.drifting) {
      const fwdAngle = this.angle;
      const slideAngle = fwdAngle - this.velocityAngle;
      // Wrap to (-PI, PI]
      let wrapped = slideAngle;
      while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
      while (wrapped < -Math.PI) wrapped += 2 * Math.PI;
      this.bodyMesh.rotation.z = wrapped * 0.4;
    } else {
      this.bodyMesh.rotation.z *= 0.85;
    }
  }

  /** Sync optional drift fields from a net state snapshot. */
  private syncDriftFromNetState(state: { drifting?: boolean; velocityAngle?: number }): void {
    if (state.drifting !== undefined) {
      this.drifting = state.drifting;
    }
    if (state.velocityAngle !== undefined) {
      this.velocityAngle = state.velocityAngle;
      const speed = this.effectiveSpeed;
      this.vx = Math.sin(this.velocityAngle) * speed;
      this.vz = Math.cos(this.velocityAngle) * speed;
      this.velocity = { x: this.vx, y: 0, z: this.vz };
    }
  }

  private die(): void {
    this.alive = false;
    this.mesh.visible = false;
    this.expireActiveEffect();
    this.deathParticles = new DeathParticles(
      this.color, this.position.x, this.position.y, this.position.z, this.scene,
      this.surfaceNormal,
    );
  }

  private expireActiveEffect(): void {
    if (this.activeEffect) {
      this.activeEffect.onExpire(this);
    }
  }

  applyNetState(state: {
    x: number; z: number; y: number; angle: number;
    alive: boolean; vy: number; grounded: boolean;
    boostMeter: number; boosting: boolean;
    invulnerable?: boolean; invulnerableTimer?: number;
    doubleJumpCooldown?: number;
    drifting?: boolean; velocityAngle?: number;
    pitch?: number; flying?: boolean;
    qx?: number; qy?: number; qz?: number; qw?: number;
    surfaceId?: number;
    tick: number;
  }): void {
    // Death is always authoritative from host
    if (!state.alive && this.alive) {
      this.die();
      return;
    }

    // Extract server quaternion (fall back to yaw-only if not provided)
    const serverQ: Quat = (state.qw !== undefined)
      ? { x: state.qx!, y: state.qy!, z: state.qz!, w: state.qw }
      : quatFromAxisAngle({ x: 0, y: 1, z: 0 }, state.angle);

    // Client-side predicted bike: snap physics to server, absorb into render offset
    if (this.isLocalPredicted) {
      const dx = state.x - this.position.x;
      const dy = state.y - this.position.y;
      const dz = state.z - this.position.z;
      const error = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (error > RENDER_OFFSET_SNAP_THRESHOLD) {
        // Large disagreement: teleport
        this.position.set(state.x, state.y, state.z);
        this.orientationQuat = serverQ;
        this.renderOffset.set(0, 0, 0);
        this.renderQuatOffset = quatIdentity();
        this.visualPos.copy(this.position);
        this.visualAngle = quatToYawAngle(serverQ);
      } else if (error > RENDER_OFFSET_MIN_CORRECTION) {
        // Absorb position correction into render offset
        this.renderOffset.x -= dx;
        this.renderOffset.y -= dy;
        this.renderOffset.z -= dz;

        // Absorb quaternion correction into render offset
        // Visual was: physicsQ * renderQuatOffset
        // Snap physics to serverQ, keep visual same:
        // serverQ * newOffset = oldPhysicsQ * oldOffset
        // newOffset = inv(serverQ) * oldPhysicsQ * oldOffset
        const oldQ = this.orientationQuat;
        this.renderQuatOffset = quatNormalize(
          quatMultiply(quatInverse(serverQ), quatMultiply(oldQ, this.renderQuatOffset)),
        );

        this.position.set(state.x, state.y, state.z);
        this.orientationQuat = serverQ;
      }

      // Always sync non-positional state from host
      this.vy = state.vy;
      this.grounded = state.grounded;
      this.boosting = state.boosting;
      this.boostMeter = state.boostMeter;
      if (state.surfaceId !== undefined) {
        this.surfaceId = state.surfaceId as SurfaceId;
        // Re-derive surface normal from position
        const info = computeSurfaceInfo({ x: state.x, y: state.y, z: state.z });
        this.surfaceNormal = info.normal;
      }
      if (state.invulnerable !== undefined) {
        this.syncInvulnerabilityFromNet(state.invulnerable, state.invulnerableTimer ?? 0);
      }
      if (state.doubleJumpCooldown !== undefined) {
        this.doubleJumpCooldown = state.doubleJumpCooldown;
        this.doubleJumpReady = state.doubleJumpCooldown <= 0;
      }
      this.syncDriftFromNetState(state);
      if (state.pitch !== undefined) this.pitch = state.pitch;
      if (state.flying !== undefined) this.flying = state.flying;
      return;
    }

    // --- Normal (non-predicted) path for remote bikes ---

    // First state: snap immediately
    if (this.netBuffer.length === 0) {
      this.position.set(state.x, state.y, state.z);
      this.orientationQuat = serverQ;
      this.visualPos.copy(this.position);
      this.visualAngle = quatToYawAngle(serverQ);
      this.visualInitialized = true;
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.set(serverQ.x, serverQ.y, serverQ.z, serverQ.w);
    }

    // Push to interpolation buffer
    this.netBuffer.push({
      x: state.x, z: state.z, y: state.y,
      qx: serverQ.x, qy: serverQ.y, qz: serverQ.z, qw: serverQ.w,
      surfaceId: state.surfaceId ?? 0,
      vy: state.vy, grounded: state.grounded,
      pitch: state.pitch ?? 0, flying: state.flying ?? false,
      tick: state.tick,
      time: performance.now(),
    });
    if (this.netBuffer.length > 3) {
      this.netBuffer.shift();
    }
    this.boosting = state.boosting;
    this.boostMeter = state.boostMeter;
    if (state.invulnerable !== undefined) {
      this.syncInvulnerabilityFromNet(state.invulnerable, state.invulnerableTimer ?? 0);
    }
    if (state.doubleJumpCooldown !== undefined) {
      this.doubleJumpCooldown = state.doubleJumpCooldown;
      this.doubleJumpReady = state.doubleJumpCooldown <= 0;
    }
    this.syncDriftFromNetState(state);
  }

  private syncInvulnerabilityFromNet(isInvulnerable: boolean, timer: number): void {
    const wasInvulnerable = this.invulnerable;
    if (!wasInvulnerable && isInvulnerable) {
      const effect = createEffect('invulnerability');
      if (effect) {
        effect.onGrant(this);
        this.effectTimer = timer;
      }
    } else if (wasInvulnerable && !isInvulnerable) {
      this.expireActiveEffect();
    } else if (isInvulnerable) {
      this.effectTimer = timer;
    }
  }

  deadReckon(dt: number, renderTick?: number): void {
    if (!this.alive) return;

    if (this.netBuffer.length >= 2 && renderTick !== undefined) {
      // Tick-based interpolation with quaternion slerp
      while (this.netBuffer.length >= 3 && renderTick >= this.netBuffer[1].tick) {
        this.netBuffer.shift();
      }

      const a = this.netBuffer[0];
      const b = this.netBuffer[1];
      const tickSpan = b.tick - a.tick;
      const t = tickSpan > 0 ? (renderTick - a.tick) / tickSpan : 1.0;

      const qa: Quat = { x: a.qx, y: a.qy, z: a.qz, w: a.qw };
      const qb: Quat = { x: b.qx, y: b.qy, z: b.qz, w: b.qw };

      if (t >= 0 && t <= 1.0) {
        // Normal interpolation
        this.position.x = a.x + (b.x - a.x) * t;
        this.position.z = a.z + (b.z - a.z) * t;
        this.position.y = a.y + (b.y - a.y) * t;

        this.orientationQuat = quatSlerp(qa, qb, t);

        this.vy = a.vy + (b.vy - a.vy) * t;
        this.grounded = t < 0.5 ? a.grounded : b.grounded;
        this.pitch = a.pitch + (b.pitch - a.pitch) * t;
        this.flying = t < 0.5 ? a.flying : b.flying;
        this.surfaceId = (t < 0.5 ? a.surfaceId : b.surfaceId) as SurfaceId;
      } else if (renderTick > b.tick) {
        // Extrapolation: cap at 1 tick
        const extraTicks = renderTick - b.tick;
        const cappedSec = Math.min(extraTicks * (NET_TICK_DURATION_MS / 1000), NET_TICK_DURATION_MS / 1000);
        const speed = this.effectiveSpeed;

        // Use quaternion forward for extrapolation direction
        const fwd = quatRotateVec3(qb, { x: 0, y: 0, z: 1 });
        const cosPitch = b.flying ? Math.cos(b.pitch) : 1;
        this.position.x = b.x + fwd.x * speed * cosPitch * cappedSec;
        this.position.y = b.y + fwd.y * speed * cosPitch * cappedSec;
        this.position.z = b.z + fwd.z * speed * cosPitch * cappedSec;
        this.orientationQuat = qb;
        this.vy = b.vy;
        this.grounded = b.grounded;
        this.pitch = b.pitch;
        this.flying = b.flying;
        this.surfaceId = b.surfaceId as SurfaceId;
      } else {
        // Behind buffer
        this.position.x = a.x;
        this.position.z = a.z;
        this.position.y = a.y;
        this.orientationQuat = qa;
        this.vy = a.vy;
        this.grounded = a.grounded;
        this.pitch = a.pitch;
        this.flying = a.flying;
        this.surfaceId = a.surfaceId as SurfaceId;
      }
    } else if (this.netBuffer.length >= 2) {
      // Fallback: time-based interpolation
      const a = this.netBuffer[0];
      const b = this.netBuffer[1];
      const duration = b.time - a.time;
      const elapsed = performance.now() - a.time;
      const t = duration > 0 ? Math.min(elapsed / duration, 1.5) : 1.0;
      const tClamped = Math.min(t, 1.0);

      this.position.x = a.x + (b.x - a.x) * tClamped;
      this.position.z = a.z + (b.z - a.z) * tClamped;
      this.position.y = a.y + (b.y - a.y) * tClamped;

      const qa: Quat = { x: a.qx, y: a.qy, z: a.qz, w: a.qw };
      const qb: Quat = { x: b.qx, y: b.qy, z: b.qz, w: b.qw };
      this.orientationQuat = quatSlerp(qa, qb, tClamped);

      this.pitch = a.pitch + (b.pitch - a.pitch) * tClamped;
      this.flying = tClamped < 0.5 ? a.flying : b.flying;
      this.surfaceId = (tClamped < 0.5 ? a.surfaceId : b.surfaceId) as SurfaceId;

      if (t >= 1.0 && this.netBuffer.length >= 3) {
        this.netBuffer.shift();
      }
    }

    // Snap to surface after interpolation (constraint #7)
    if (this.grounded) {
      const pos: Vec3 = { x: this.position.x, y: this.position.y, z: this.position.z };
      const info = computeSurfaceInfo(pos);
      if (info.drivable && Math.abs(info.distance) < 2.0) {
        const snapped = snapToSurface(pos, info);
        this.position.set(snapped.x, snapped.y, snapped.z);
        this.surfaceNormal = info.normal;
      }
    }

    // Remote bikes: visual tracks interpolated position directly
    this.visualPos.copy(this.position);
    this.visualAngle = this.angle;
    this.visualInitialized = true;
    this.mesh.position.copy(this.visualPos);
    this.mesh.quaternion.set(
      this.orientationQuat.x, this.orientationQuat.y,
      this.orientationQuat.z, this.orientationQuat.w,
    );

    this.updateBodyPitch();
    this.updateDriftLean();

    // Effect visual update (for remote bikes)
    if (this.activeEffect) {
      this.activeEffect.onUpdate(this, dt);
    }

    const dFwd = quatRotateVec3(this.orientationQuat, { x: 0, y: 0, z: 1 });
    const dUp = this.surfaceNormal;
    this.trailParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded, this.flying, dFwd, dUp);
    this.driftParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded, this.drifting, dFwd, dUp);
  }

  /** Position for camera targeting — uses smoothed visual position when available */
  get renderPosition(): THREE.Vector3 {
    return this.visualInitialized ? this.visualPos : this.position;
  }

  get renderAngle(): number {
    return this.visualInitialized ? this.visualAngle : this.angle;
  }

  reset(x: number, z: number, angle: number): void {
    this.position.set(x, 0, z);
    this.orientationQuat = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, angle);
    this.surfaceNormal = { x: 0, y: 1, z: 0 };
    this.surfaceId = SurfaceId.FLOOR;
    this.vy = 0;
    this.alive = true;
    this.grounded = true;
    this.jumpCooldown = 0;
    this.boostMeter = BOOST_MAX;
    this.boosting = false;
    this.expireActiveEffect();
    this.lastTrailDestruction = null;
    this.doubleJumpReady = true;
    this.doubleJumpCooldown = 0;
    this.usedDoubleJumpThisAirborne = false;
    this.boostRechargeTimer = 0;
    this.drifting = false;
    this.driftTimer = 0;
    this.initVelocity(angle);
    this.airborneVelocity = { x: 0, y: 0, z: 0 };
    this.pitch = 0;
    this.flying = false;
    this.netBuffer = [];
    this.renderOffset.set(0, 0, 0);
    this.renderQuatOffset = quatIdentity();
    this.visualPos.copy(this.position);
    this.visualAngle = angle;
    this.visualInitialized = false;
    this.mesh.visible = true;
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.set(
      this.orientationQuat.x, this.orientationQuat.y,
      this.orientationQuat.z, this.orientationQuat.w,
    );
    this.trail.reset();

    if (this.deathParticles) {
      this.deathParticles.dispose(this.scene);
      this.deathParticles = null;
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.trailParticles.dispose(scene);
    this.driftParticles.dispose(scene);
    this.trail.dispose(scene);
    if (this.deathParticles) {
      this.deathParticles.dispose(scene);
    }
  }
}
