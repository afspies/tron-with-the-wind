import * as THREE from 'three';
import {
  BIKE_SPEED, TURN_RATE,
  JUMP_INITIAL_VY, GRAVITY, JUMP_COOLDOWN,
  BOOST_MULTIPLIER, BOOST_MAX, BOOST_DRAIN, BOOST_RECHARGE, BOOST_RECHARGE_DELAY,
  NET_TICK_DURATION_MS, VISUAL_CORRECTION_RATE,
  RENDER_OFFSET_SNAP_THRESHOLD, RENDER_OFFSET_MIN_CORRECTION,
  ARENA_HALF, ARENA_CEILING_HEIGHT, TRAIL_DESTROY_RADIUS,
  DOUBLE_JUMP_COOLDOWN,
  DRIFT_TURN_MULTIPLIER, DRIFT_SPEED_MULTIPLIER, DRIFT_TRACTION, NORMAL_TRACTION,
  FLIGHT_PITCH_RATE, FLIGHT_MAX_PITCH,
  FLIGHT_THRUST, FLIGHT_AIR_TURN_MULT, FLIGHT_BOOST_DRAIN_MULT,
  BIKE_COLLISION_HEIGHT,
  WORLD_BOUNCE_RESTITUTION, WORLD_BOUNCE_MIN_SPEED, WORLD_BOUNCE_TANGENT_DAMPING,
  WALL_RIDE_GRAVITY_MULTIPLIER, WALL_RIDE_CLIMB_MULTIPLIER, WALL_RIDE_ATTACH_DOT_MIN,
  WALL_RIDE_STICK_DISTANCE, WALL_HEIGHT, MAP_PLATFORMS,
  WALL_RAMP_WIDTH, WALL_RAMP_DEPTH, WALL_RAMP_HEIGHT,
} from '@tron/shared';
import type { Vec2, PlayerInput } from '@tron/shared';
import type { SimBike } from '@tron/game-core';
import { Trail } from './Trail';
import { checkTrailCollision, checkTrailCollisionDetailed } from './Collision';
import type { PowerUpEffect } from './powerups/PowerUpEffect';
import { createEffect } from './powerups/PowerUpRegistry';
import { TrailParticles, DriftParticles, DeathParticles } from './BikeParticles';

/** Normalize an angle difference to the range (-PI, PI]. */
function wrapAngle(diff: number): number {
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

export class Bike {
  mesh: THREE.Group;
  trail: Trail;
  position: THREE.Vector3;
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

  // Generic effect slot
  activeEffect: PowerUpEffect | null = null;
  effectTimer = 0;

  // Backwards-compatible getters for invulnerability
  get invulnerable(): boolean {
    return this.activeEffect?.type === 'invulnerability' && this.effectTimer > 0;
  }
  get invulnerableTimer(): number {
    return this.invulnerable ? this.effectTimer : 0;
  }

  lastTrailDestruction: { trailIndex: number; contactX: number; contactZ: number } | null = null;

  // Double jump (innate ability with cooldown)
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
  wallNormal: Vec2 | null = null;

  // Client-side prediction: local player's bike runs physics locally
  isLocalPredicted = false;

  // Render offset: after physics snaps to server, visual offset decays smoothly
  renderOffset = new THREE.Vector3();
  renderAngleOffset = 0;

  // Rendered position/angle (includes render offset for predicted bikes)
  visualPos: THREE.Vector3;
  visualAngle: number;
  private visualInitialized = false;
  private readonly targetQuat = new THREE.Quaternion();
  private readonly upVec = new THREE.Vector3();
  private readonly forwardVec = new THREE.Vector3();
  private readonly rightVec = new THREE.Vector3();
  private readonly basisMat = new THREE.Matrix4();

  private netBuffer: Array<{ x: number; z: number; y: number; angle: number; vy: number; grounded: boolean; pitch: number; flying: boolean; wallNormalX: number; wallNormalZ: number; tick: number; time: number }> = [];
  private bodyMesh: THREE.Mesh;
  private bikeLight: THREE.PointLight;
  private scene: THREE.Scene;

  // Particles (delegated)
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
    this.angle = angle;
    this.velocityAngle = angle;
    this.speed = BIKE_SPEED;
    this.deriveVelocityFromAngle();
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

    // Wheels (cylinders)
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
    this.applyVisualOrientation(1 / 60, true);
    scene.add(this.mesh);

    // Trail
    this.trail = new Trail(color, scene);

    // Trail spawn particles
    this.trailParticles = new TrailParticles(color, scene);

    // Drift spark particles
    this.driftParticles = new DriftParticles(color, scene);
  }

  update(dt: number, input: PlayerInput, allTrails: Trail[], skipCollision = false): void {
    if (!this.alive) {
      this.deathParticles?.update(dt);
      return;
    }

    const oldPos3D = { x: this.position.x, y: this.position.y, z: this.position.z };
    const oldPos = { x: this.position.x, z: this.position.z };

    const wantsDrift = input.drift && this.grounded && !this.wallNormal;
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

    this.boosting = input.boost && this.boostMeter > 0;
    this.flying = !this.grounded && !this.wallNormal && this.usedDoubleJumpThisAirborne && this.boosting;

    if (this.boosting) {
      const drain = this.flying ? BOOST_DRAIN * FLIGHT_BOOST_DRAIN_MULT : BOOST_DRAIN;
      this.boostMeter = Math.max(0, this.boostMeter - drain * dt);
      this.boostRechargeTimer = BOOST_RECHARGE_DELAY;
    } else if (this.boostRechargeTimer > 0) {
      this.boostRechargeTimer -= dt;
    } else {
      const fillFraction = this.boostMeter / BOOST_MAX;
      const rate = BOOST_RECHARGE * (0.3 + 0.7 * fillFraction);
      this.boostMeter = Math.min(BOOST_MAX, this.boostMeter + rate * dt);
    }
    const currentSpeed = this.effectiveSpeed;
    const forward: Vec2 = { x: Math.sin(this.angle), z: Math.cos(this.angle) };

    if (!this.grounded && !this.wallNormal) {
      if (input.pitchUp) {
        this.pitch = Math.min(FLIGHT_MAX_PITCH, this.pitch + FLIGHT_PITCH_RATE * dt);
      } else if (input.pitchDown) {
        this.pitch = Math.max(0, this.pitch - FLIGHT_PITCH_RATE * dt);
      }
    } else {
      this.pitch = 0;
    }

    // Velocity vector traction blend
    const desiredVx = forward.x * currentSpeed;
    const desiredVz = forward.z * currentSpeed;
    const traction = this.drifting ? DRIFT_TRACTION : NORMAL_TRACTION;
    const t = 1 - Math.exp(-traction * dt);
    this.vx += (desiredVx - this.vx) * t;
    this.vz += (desiredVz - this.vz) * t;

    // Renormalize to maintain constant speed
    const len = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    if (len > 0.001) {
      this.vx = (this.vx / len) * currentSpeed;
      this.vz = (this.vz / len) * currentSpeed;
    }

    // Derive velocityAngle for visuals
    this.velocityAngle = Math.atan2(this.vx, this.vz);

    if (this.wallNormal) {
      this.moveAlongWall(dt, currentSpeed, forward);
    } else if (this.flying) {
      const horizSpeed = BIKE_SPEED * BOOST_MULTIPLIER * Math.cos(this.pitch);
      this.position.x += forward.x * horizSpeed * dt;
      this.position.z += forward.z * horizSpeed * dt;
      this.vy += FLIGHT_THRUST * Math.sin(this.pitch) * dt;
    } else if (!this.grounded && this.pitch > 0) {
      const horizSpeed = BIKE_SPEED * Math.cos(this.pitch);
      this.position.x += forward.x * horizSpeed * dt;
      this.position.z += forward.z * horizSpeed * dt;
    } else {
      this.position.x += this.vx * dt;
      this.position.z += this.vz * dt;
    }

    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    if (input.jump && this.jumpCooldown <= 0) {
      if (this.wallNormal) {
        this.jumpOffWall(currentSpeed);
      } else if (this.grounded) {
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

    if (this.wallNormal) {
      this.position.y += this.vy * dt;
      this.vy -= GRAVITY * WALL_RIDE_GRAVITY_MULTIPLIER * dt;
    } else if (!this.grounded) {
      this.position.y += this.vy * dt;
      this.vy -= GRAVITY * dt;
    }

    this.resolveFloorContact();
    this.resolveCeilingBounce();
    this.resolveArenaWallContact(forward, currentSpeed);
    this.resolvePlatformCollisions(oldPos3D);
    this.resolvePlatformSupport();

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

    if (!skipCollision) {
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

    // Update trail (follows bike Y for 3D arcs)
    this.trail.addPoint(this.position.x, this.position.y, this.position.z);

    // Predicted bikes: decay render offset so visual smoothly converges to physics
    if (this.isLocalPredicted) {
      const decay = Math.exp(-VISUAL_CORRECTION_RATE * dt);
      this.renderOffset.multiplyScalar(decay);
      this.renderAngleOffset *= decay;
      if (this.renderOffset.lengthSq() < 0.0001) this.renderOffset.set(0, 0, 0);
      if (Math.abs(this.renderAngleOffset) < 0.001) this.renderAngleOffset = 0;
    }

    // Compute visual position (physics + render offset for predicted bikes)
    this.visualPos.copy(this.position).add(this.renderOffset);
    this.visualAngle = this.angle + this.renderAngleOffset;
    this.visualInitialized = true;
    this.mesh.position.copy(this.visualPos);
    this.applyVisualOrientation(dt);

    this.updateBodyPitch();
    this.updateDriftLean();

    // Spawn trail particles (use visual position to prevent particle pop on snap)
    this.trailParticles.update(dt, this.visualPos.x, this.visualPos.y, this.visualPos.z, this.visualAngle, this.grounded, this.flying);
    this.driftParticles.update(dt, this.visualPos.x, this.visualPos.y, this.visualPos.z, this.visualAngle, this.grounded, this.drifting);
  }

  private moveAlongWall(dt: number, currentSpeed: number, forward: Vec2): void {
    if (!this.wallNormal) return;

    const normal = this.wallNormal;
    const tangent = { x: normal.z, z: -normal.x };
    const alongWall = forward.x * tangent.x + forward.z * tangent.z;
    const intoWall = Math.max(0, -(forward.x * normal.x + forward.z * normal.z));

    this.vy += currentSpeed * intoWall * WALL_RIDE_CLIMB_MULTIPLIER * dt;
    this.position.x += tangent.x * currentSpeed * alongWall * dt;
    this.position.z += tangent.z * currentSpeed * alongWall * dt;

    this.stickToWall(normal);

    const facingAway = forward.x * normal.x + forward.z * normal.z;
    if (facingAway > 0.35) {
      this.wallNormal = null;
    }
  }

  private jumpOffWall(currentSpeed: number): void {
    if (!this.wallNormal) return;
    const normal = this.wallNormal;
    this.wallNormal = null;
    this.vy = JUMP_INITIAL_VY;
    this.vx += normal.x * currentSpeed * 0.5;
    this.vz += normal.z * currentSpeed * 0.5;
    this.grounded = false;
    this.jumpCooldown = JUMP_COOLDOWN;
  }

  private resolveFloorContact(): void {
    const supportY = this.getGroundSupportY(this.position.x, this.position.z);
    if (this.position.y > supportY) return;
    const wasOffGround = !this.grounded || this.wallNormal !== null;
    this.position.y = supportY;
    this.vy = 0;
    this.grounded = true;
    this.pitch = 0;
    this.flying = false;
    this.wallNormal = null;
    if (wasOffGround) {
      this.jumpCooldown = Math.max(this.jumpCooldown, JUMP_COOLDOWN);
    }
  }

  private resolveCeilingBounce(): void {
    const ceilingBaseY = ARENA_CEILING_HEIGHT - BIKE_COLLISION_HEIGHT;
    if (this.position.y <= ceilingBaseY) return;

    this.position.y = ceilingBaseY;
    if (this.vy > 0) {
      this.vy = -Math.max(this.vy * WORLD_BOUNCE_RESTITUTION, WORLD_BOUNCE_MIN_SPEED);
    }
    this.grounded = false;
    this.flying = false;
    this.wallNormal = null;
    this.pitch = 0;
  }

  private resolveArenaWallContact(forward: Vec2, currentSpeed: number): void {
    if (this.position.x > ARENA_HALF) {
      this.position.x = ARENA_HALF;
      this.handleSideSurface({ x: -1, z: 0 }, forward, currentSpeed);
    } else if (this.position.x < -ARENA_HALF) {
      this.position.x = -ARENA_HALF;
      this.handleSideSurface({ x: 1, z: 0 }, forward, currentSpeed);
    }

    if (this.position.z > ARENA_HALF) {
      this.position.z = ARENA_HALF;
      this.handleSideSurface({ x: 0, z: -1 }, forward, currentSpeed);
    } else if (this.position.z < -ARENA_HALF) {
      this.position.z = -ARENA_HALF;
      this.handleSideSurface({ x: 0, z: 1 }, forward, currentSpeed);
    }

    if (this.wallNormal) {
      const dist = this.wallNormal.x !== 0
        ? Math.abs(Math.abs(this.position.x) - ARENA_HALF)
        : Math.abs(Math.abs(this.position.z) - ARENA_HALF);
      if (dist > WALL_RIDE_STICK_DISTANCE) this.wallNormal = null;
    }
  }

  private handleSideSurface(normal: Vec2, forward: Vec2, currentSpeed: number): void {
    const intoWall = -(forward.x * normal.x + forward.z * normal.z);
    const canAttach = this.position.y >= 0 && this.position.y <= WALL_HEIGHT && intoWall > WALL_RIDE_ATTACH_DOT_MIN;

    if (canAttach) {
      this.wallNormal = { x: normal.x, z: normal.z };
      this.grounded = false;
      this.flying = false;
      this.vy = Math.max(this.vy, currentSpeed * intoWall * WALL_RIDE_CLIMB_MULTIPLIER * 0.35);
      this.stickToWall(normal);
      return;
    }

    this.wallNormal = null;
    this.reflectHorizontal(normal);
  }

  private resolvePlatformCollisions(oldPos: { x: number; y: number; z: number }): void {
    for (const p of MAP_PLATFORMS) {
      const minX = p.x - p.width * 0.5;
      const maxX = p.x + p.width * 0.5;
      const minY = p.y - p.height * 0.5;
      const maxY = p.y + p.height * 0.5;
      const minZ = p.z - p.depth * 0.5;
      const maxZ = p.z + p.depth * 0.5;

      const withinX = this.position.x >= minX && this.position.x <= maxX;
      const withinZ = this.position.z >= minZ && this.position.z <= maxZ;

      if (withinX && withinZ) {
        if (oldPos.y >= maxY && this.position.y <= maxY && this.vy <= 0) {
          this.position.y = maxY;
          this.vy = 0;
          this.grounded = true;
          this.flying = false;
          this.wallNormal = null;
          this.pitch = 0;
          return;
        }

        const oldTop = oldPos.y + BIKE_COLLISION_HEIGHT;
        const newTop = this.position.y + BIKE_COLLISION_HEIGHT;
        if (oldTop <= minY && newTop >= minY && this.vy > 0) {
          this.position.y = minY - BIKE_COLLISION_HEIGHT;
          this.vy = -Math.max(this.vy * WORLD_BOUNCE_RESTITUTION, WORLD_BOUNCE_MIN_SPEED);
          this.grounded = false;
          this.flying = false;
          this.wallNormal = null;
          this.pitch = 0;
        }
      }

      const overlapsY = this.position.y < maxY && this.position.y + BIKE_COLLISION_HEIGHT > minY;
      if (!overlapsY) continue;

      if (this.position.z >= minZ && this.position.z <= maxZ) {
        if (oldPos.x <= minX && this.position.x > minX) {
          this.position.x = minX;
          this.reflectHorizontal({ x: -1, z: 0 });
        } else if (oldPos.x >= maxX && this.position.x < maxX) {
          this.position.x = maxX;
          this.reflectHorizontal({ x: 1, z: 0 });
        }
      }

      if (this.position.x >= minX && this.position.x <= maxX) {
        if (oldPos.z <= minZ && this.position.z > minZ) {
          this.position.z = minZ;
          this.reflectHorizontal({ x: 0, z: -1 });
        } else if (oldPos.z >= maxZ && this.position.z < maxZ) {
          this.position.z = maxZ;
          this.reflectHorizontal({ x: 0, z: 1 });
        }
      }
    }
  }

  private resolvePlatformSupport(): void {
    if (!this.grounded || this.wallNormal) return;

    const supportY = this.getGroundSupportY(this.position.x, this.position.z);
    if (Math.abs(this.position.y - supportY) < 0.05) return;

    for (const p of MAP_PLATFORMS) {
      const minX = p.x - p.width * 0.5;
      const maxX = p.x + p.width * 0.5;
      const maxY = p.y + p.height * 0.5;
      const minZ = p.z - p.depth * 0.5;
      const maxZ = p.z + p.depth * 0.5;

      const nearTop = Math.abs(this.position.y - maxY) < 0.05;
      const withinX = this.position.x >= minX && this.position.x <= maxX;
      const withinZ = this.position.z >= minZ && this.position.z <= maxZ;
      if (nearTop && withinX && withinZ) return;
    }

    this.grounded = false;
  }

  private reflectHorizontal(normal: Vec2): void {
    const tangent = { x: -normal.z, z: normal.x };
    const vn = this.vx * normal.x + this.vz * normal.z;
    if (vn >= 0) return;

    const reflectedVx = this.vx - (1 + WORLD_BOUNCE_RESTITUTION) * vn * normal.x;
    const reflectedVz = this.vz - (1 + WORLD_BOUNCE_RESTITUTION) * vn * normal.z;

    const outN = reflectedVx * normal.x + reflectedVz * normal.z;
    const outT = (reflectedVx * tangent.x + reflectedVz * tangent.z) * WORLD_BOUNCE_TANGENT_DAMPING;

    this.vx = outN * normal.x + outT * tangent.x;
    this.vz = outN * normal.z + outT * tangent.z;

    this.velocityAngle = Math.atan2(this.vx, this.vz);
    this.angle = this.velocityAngle;
  }

  private stickToWall(normal: Vec2): void {
    if (normal.x !== 0) this.position.x = -normal.x * ARENA_HALF;
    if (normal.z !== 0) this.position.z = -normal.z * ARENA_HALF;
  }

  private getGroundSupportY(x: number, z: number): number {
    return Math.max(0, this.getRampHeightAt(x, z));
  }

  private getRampHeightAt(x: number, z: number): number {
    let rampY = 0;

    if (Math.abs(x) <= WALL_RAMP_WIDTH * 0.5) {
      const northDist = ARENA_HALF - z;
      if (northDist >= 0 && northDist <= WALL_RAMP_DEPTH) {
        rampY = Math.max(rampY, (1 - northDist / WALL_RAMP_DEPTH) * WALL_RAMP_HEIGHT);
      }

      const southDist = ARENA_HALF + z;
      if (southDist >= 0 && southDist <= WALL_RAMP_DEPTH) {
        rampY = Math.max(rampY, (1 - southDist / WALL_RAMP_DEPTH) * WALL_RAMP_HEIGHT);
      }
    }

    if (Math.abs(z) <= WALL_RAMP_WIDTH * 0.5) {
      const eastDist = ARENA_HALF - x;
      if (eastDist >= 0 && eastDist <= WALL_RAMP_DEPTH) {
        rampY = Math.max(rampY, (1 - eastDist / WALL_RAMP_DEPTH) * WALL_RAMP_HEIGHT);
      }

      const westDist = ARENA_HALF + x;
      if (westDist >= 0 && westDist <= WALL_RAMP_DEPTH) {
        rampY = Math.max(rampY, (1 - westDist / WALL_RAMP_DEPTH) * WALL_RAMP_HEIGHT);
      }
    }

    return rampY;
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
      );
    }

    if (!this.alive) {
      this.deathParticles?.update(dt);
      return;
    }

    // Copy physics state
    this.position.set(simBike.position.x, simBike.position.y, simBike.position.z);
    this.angle = simBike.angle;
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
    this.wallNormal = simBike.wallNormal ? { ...simBike.wallNormal } : null;

    // Sync invulnerability visual effect
    this.syncInvulnerabilityFromNet(simBike.invulnerable, simBike.invulnerableTimer);

    // Update mesh
    this.visualPos.copy(this.position);
    this.visualAngle = this.angle;
    this.mesh.position.copy(this.position);
    this.applyVisualOrientation(dt, true);

    this.updateBodyPitch();
    this.updateDriftLean();

    // Sync trail from simulation
    this.trail.syncFromSimTrail(simBike.trail.points);

    // Update particles
    this.trailParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded, this.flying);
    this.driftParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded, this.drifting);

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

  /** Recompute vx/vz from the current velocityAngle and effective speed. */
  private deriveVelocityFromAngle(): void {
    const speed = this.effectiveSpeed;
    this.vx = Math.sin(this.velocityAngle) * speed;
    this.vz = Math.cos(this.velocityAngle) * speed;
  }

  private updateBodyPitch(): void {
    if (this.wallNormal) {
      this.bodyMesh.rotation.x *= 0.8;
      return;
    }

    if (this.flying || this.pitch > 0.01) {
      this.bodyMesh.rotation.x = -this.pitch;
    } else if (!this.grounded) {
      this.bodyMesh.rotation.x = -(this.vy / JUMP_INITIAL_VY) * 0.2;
    } else {
      this.bodyMesh.rotation.x = 0;
    }
  }

  /** Apply body lean based on the angle between heading and velocity. */
  private updateDriftLean(): void {
    if (this.wallNormal) {
      this.bodyMesh.rotation.z *= 0.75;
      return;
    }

    if (this.drifting) {
      const slideAngle = wrapAngle(this.angle - this.velocityAngle);
      this.bodyMesh.rotation.z = slideAngle * 0.4;
    } else {
      this.bodyMesh.rotation.z *= 0.85;
    }
  }

  private applyVisualOrientation(dt: number, snap = false): void {
    if (this.wallNormal) {
      this.upVec.set(this.wallNormal.x, 0, this.wallNormal.z).normalize();
    } else {
      this.upVec.set(0, 1, 0);
    }

    this.forwardVec.set(Math.sin(this.visualAngle), 0, Math.cos(this.visualAngle));
    this.forwardVec.addScaledVector(this.upVec, -this.forwardVec.dot(this.upVec));
    if (this.forwardVec.lengthSq() < 1e-5) {
      if (Math.abs(this.upVec.z) > 0.7) {
        this.forwardVec.set(1, 0, 0);
      } else {
        this.forwardVec.set(0, 0, 1);
      }
      this.forwardVec.addScaledVector(this.upVec, -this.forwardVec.dot(this.upVec)).normalize();
    } else {
      this.forwardVec.normalize();
    }

    this.rightVec.crossVectors(this.upVec, this.forwardVec).normalize();
    this.forwardVec.crossVectors(this.rightVec, this.upVec).normalize();

    this.basisMat.makeBasis(this.rightVec, this.upVec, this.forwardVec);
    this.targetQuat.setFromRotationMatrix(this.basisMat);

    if (snap) {
      this.mesh.quaternion.copy(this.targetQuat);
      return;
    }

    const blend = this.wallNormal ? 1 - Math.exp(-16 * dt) : 1 - Math.exp(-10 * dt);
    this.mesh.quaternion.slerp(this.targetQuat, blend);
  }

  /** Sync optional drift fields from a net state snapshot. */
  private syncDriftFromNetState(state: { drifting?: boolean; velocityAngle?: number }): void {
    if (state.drifting !== undefined) {
      this.drifting = state.drifting;
    }
    if (state.velocityAngle !== undefined) {
      this.velocityAngle = state.velocityAngle;
      this.deriveVelocityFromAngle();
    }
  }

  private setWallNormalFromNet(state: { wallNormalX?: number; wallNormalZ?: number }): void {
    if (state.wallNormalX === undefined || state.wallNormalZ === undefined) return;
    const hasWall = Math.abs(state.wallNormalX) > 1e-4 || Math.abs(state.wallNormalZ) > 1e-4;
    this.wallNormal = hasWall ? { x: state.wallNormalX, z: state.wallNormalZ } : null;
  }

  private die(): void {
    this.alive = false;
    this.mesh.visible = false;
    this.expireActiveEffect();
    this.deathParticles = new DeathParticles(
      this.color, this.position.x, this.position.y, this.position.z, this.scene,
    );
  }

  private expireActiveEffect(): void {
    if (this.activeEffect) {
      this.activeEffect.onExpire(this);
    }
  }

  applyNetState(state: { x: number; z: number; y: number; angle: number; alive: boolean; vy: number; grounded: boolean; boostMeter: number; boosting: boolean; invulnerable?: boolean; invulnerableTimer?: number; doubleJumpCooldown?: number; drifting?: boolean; velocityAngle?: number; pitch?: number; flying?: boolean; wallNormalX?: number; wallNormalZ?: number; tick: number }): void {
    // Death is always authoritative from host
    if (!state.alive && this.alive) {
      this.die();
      return;
    }

    // Client-side predicted bike: snap physics to server, absorb into render offset
    if (this.isLocalPredicted) {
      const dx = state.x - this.position.x;
      const dy = state.y - this.position.y;
      const dz = state.z - this.position.z;
      const error = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (error > RENDER_OFFSET_SNAP_THRESHOLD) {
        // Large disagreement: teleport (snap everything, zero offset)
        this.position.set(state.x, state.y, state.z);
        this.angle = state.angle;
        this.renderOffset.set(0, 0, 0);
        this.renderAngleOffset = 0;
        this.visualPos.copy(this.position);
        this.visualAngle = this.angle;
      } else if (error > RENDER_OFFSET_MIN_CORRECTION) {
        // Snap physics to server, absorb correction into render offset
        // renderOffset -= (serverPos - predictedPos) keeps visual where it was
        this.renderOffset.x -= dx;
        this.renderOffset.y -= dy;
        this.renderOffset.z -= dz;
        this.renderAngleOffset -= wrapAngle(state.angle - this.angle);
        this.position.set(state.x, state.y, state.z);
        this.angle = state.angle;
      }

      // Always sync non-positional state from host
      this.vy = state.vy;
      this.grounded = state.grounded;
      this.setWallNormalFromNet(state);
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
      if (state.pitch !== undefined) this.pitch = state.pitch;
      if (state.flying !== undefined) this.flying = state.flying;
      return;
    }

    // --- Normal (non-predicted) path for remote bikes ---

    // First state: snap immediately so bike appears at correct position
    if (this.netBuffer.length === 0) {
      this.position.set(state.x, state.y, state.z);
      this.angle = state.angle;
      this.setWallNormalFromNet(state);
      this.visualPos.copy(this.position);
      this.visualAngle = this.angle;
      this.visualInitialized = true;
      this.mesh.position.copy(this.position);
      this.applyVisualOrientation(1 / 60, true);
    }
    // Push to interpolation buffer (keep last 3 for smooth interpolation)
    this.netBuffer.push({
      x: state.x, z: state.z, y: state.y, angle: state.angle,
      vy: state.vy, grounded: state.grounded,
      pitch: state.pitch ?? 0, flying: state.flying ?? false,
      wallNormalX: state.wallNormalX ?? 0,
      wallNormalZ: state.wallNormalZ ?? 0,
      tick: state.tick,
      time: performance.now(),
    });
    // With 3 buffered states, we interpolate between [0] and [1] (one tick behind),
    // giving the newest state [2] time to arrive before we need it.
    if (this.netBuffer.length > 3) {
      this.netBuffer.shift();
    }
    this.boosting = state.boosting;
    this.boostMeter = state.boostMeter;
    this.setWallNormalFromNet(state);
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
      // Became invulnerable — create effect
      const effect = createEffect('invulnerability');
      if (effect) {
        effect.onGrant(this);
        this.effectTimer = timer;
      }
    } else if (wasInvulnerable && !isInvulnerable) {
      // Lost invulnerability
      this.expireActiveEffect();
    } else if (isInvulnerable) {
      // Still invulnerable — sync timer
      this.effectTimer = timer;
    }
  }

  deadReckon(dt: number, renderTick?: number): void {
    if (!this.alive) return;

    if (this.netBuffer.length >= 2 && renderTick !== undefined) {
      // Tick-based interpolation: find buffer entries straddling renderTick
      // Advance buffer when we've passed beyond netBuffer[1].tick
      while (this.netBuffer.length >= 3 && renderTick >= this.netBuffer[1].tick) {
        this.netBuffer.shift();
      }

      const a = this.netBuffer[0];
      const b = this.netBuffer[1];
      const tickSpan = b.tick - a.tick;
      const t = tickSpan > 0 ? (renderTick - a.tick) / tickSpan : 1.0;

      if (t >= 0 && t <= 1.0) {
        // Normal interpolation between states A and B
        this.position.x = a.x + (b.x - a.x) * t;
        this.position.z = a.z + (b.z - a.z) * t;
        this.position.y = a.y + (b.y - a.y) * t;

        this.angle = a.angle + wrapAngle(b.angle - a.angle) * t;

        this.vy = a.vy + (b.vy - a.vy) * t;
        this.grounded = t < 0.5 ? a.grounded : b.grounded;
        this.pitch = a.pitch + (b.pitch - a.pitch) * t;
        this.flying = t < 0.5 ? a.flying : b.flying;
        const wallState = t < 0.5 ? a : b;
        this.wallNormal = (wallState.wallNormalX !== 0 || wallState.wallNormalZ !== 0)
          ? { x: wallState.wallNormalX, z: wallState.wallNormalZ }
          : null;
      } else if (renderTick > b.tick) {
        // Extrapolation: renderTick ahead of buffer, no newer state yet.
        // Use boost-aware speed; cap at 1 tick to avoid overshooting turns.
        const extraTicks = renderTick - b.tick;
        const cappedSec = Math.min(extraTicks * (NET_TICK_DURATION_MS / 1000), NET_TICK_DURATION_MS / 1000);
        const speed = this.effectiveSpeed;
        const cosPitch = b.flying ? Math.cos(b.pitch) : 1;
        const extraAngle = this.drifting ? this.velocityAngle : b.angle;
        this.position.x = b.x + Math.sin(extraAngle) * speed * cosPitch * cappedSec;
        this.position.z = b.z + Math.cos(extraAngle) * speed * cosPitch * cappedSec;
        this.position.y = b.y;
        this.angle = b.angle;
        this.vy = b.vy;
        this.grounded = b.grounded;
        this.pitch = b.pitch;
        this.flying = b.flying;
        this.wallNormal = (b.wallNormalX !== 0 || b.wallNormalZ !== 0)
          ? { x: b.wallNormalX, z: b.wallNormalZ }
          : null;
      } else {
        // renderTick behind buffer — snap to earliest known state
        this.position.x = a.x;
        this.position.z = a.z;
        this.position.y = a.y;
        this.angle = a.angle;
        this.vy = a.vy;
        this.grounded = a.grounded;
        this.pitch = a.pitch;
        this.flying = a.flying;
        this.wallNormal = (a.wallNormalX !== 0 || a.wallNormalZ !== 0)
          ? { x: a.wallNormalX, z: a.wallNormalZ }
          : null;
      }
    } else if (this.netBuffer.length >= 2) {
      // Fallback: time-based interpolation when renderTick not available
      const a = this.netBuffer[0];
      const b = this.netBuffer[1];
      const duration = b.time - a.time;
      const elapsed = performance.now() - a.time;
      const t = duration > 0 ? Math.min(elapsed / duration, 1.5) : 1.0;
      const tClamped = Math.min(t, 1.0);

      this.position.x = a.x + (b.x - a.x) * tClamped;
      this.position.z = a.z + (b.z - a.z) * tClamped;
      this.position.y = a.y + (b.y - a.y) * tClamped;

      this.angle = a.angle + wrapAngle(b.angle - a.angle) * tClamped;

      this.pitch = a.pitch + (b.pitch - a.pitch) * tClamped;
      this.flying = tClamped < 0.5 ? a.flying : b.flying;
      const wallState = tClamped < 0.5 ? a : b;
      this.wallNormal = (wallState.wallNormalX !== 0 || wallState.wallNormalZ !== 0)
        ? { x: wallState.wallNormalX, z: wallState.wallNormalZ }
        : null;

      if (t >= 1.0 && this.netBuffer.length >= 3) {
        this.netBuffer.shift();
      }
    }
    // With 0 or 1 state, position/angle are already set from applyNetState

    // Remote bikes: no render offset, visual tracks interpolated position directly
    this.visualPos.copy(this.position);
    this.visualAngle = this.angle;
    this.visualInitialized = true;
    this.mesh.position.copy(this.visualPos);
    this.applyVisualOrientation(dt);

    this.updateBodyPitch();
    this.updateDriftLean();

    // Effect visual update (for remote bikes)
    if (this.activeEffect) {
      this.activeEffect.onUpdate(this, dt);
    }

    this.trailParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded, this.flying);
    this.driftParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded, this.drifting);
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
    this.angle = angle;
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
    this.velocityAngle = this.angle;
    this.driftTimer = 0;
    this.deriveVelocityFromAngle();
    this.pitch = 0;
    this.flying = false;
    this.wallNormal = null;
    this.netBuffer = [];
    this.renderOffset.set(0, 0, 0);
    this.renderAngleOffset = 0;
    this.visualPos.copy(this.position);
    this.visualAngle = this.angle;
    this.visualInitialized = false;
    this.mesh.visible = true;
    this.mesh.position.copy(this.position);
    this.applyVisualOrientation(1 / 60, true);
    this.trail.reset();

    // Clean up death particles
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
