import * as THREE from 'three';
import {
  BIKE_SPEED, TURN_RATE,
  JUMP_INITIAL_VY, GRAVITY, JUMP_COOLDOWN,
  BOOST_MULTIPLIER, BOOST_MAX, BOOST_DRAIN, BOOST_RECHARGE, BOOST_RECHARGE_DELAY,
  NET_TICK_DURATION_MS, VISUAL_CORRECTION_RATE, NET_BUFFER_SIZE, EXTRAP_MAX_TICKS,
  ARENA_HALF, TRAIL_DESTROY_RADIUS,
  DOUBLE_JUMP_COOLDOWN,
} from '@tron/shared';
import type { Vec2, PlayerInput } from '@tron/shared';
import type { SimBike } from '@tron/game-core';
import { Trail } from './Trail';
import { checkTrailCollision, checkTrailCollisionDetailed, checkWallCollision } from './Collision';
import type { PowerUpEffect } from './powerups/PowerUpEffect';
import { createEffect } from './powerups/PowerUpRegistry';
import { TrailParticles, DeathParticles } from './BikeParticles';

/** Snapshot pushed into the interpolation buffer for remote bikes. */
interface NetBufferEntry {
  x: number;
  z: number;
  y: number;
  angle: number;
  vy: number;
  grounded: boolean;
  speed: number;
  boosting: boolean;
  tick: number;
  time: number;
}

/** Server-authoritative state applied via Colyseus state change callback. */
interface NetState {
  x: number;
  z: number;
  y: number;
  angle: number;
  alive: boolean;
  vy: number;
  grounded: boolean;
  boostMeter: number;
  boosting: boolean;
  invulnerable?: boolean;
  invulnerableTimer?: number;
  doubleJumpCooldown?: number;
  speed?: number;
  tick: number;
}

/** Wrap an angle difference into the range [-PI, PI]. */
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

  // Client-side prediction: local player's bike runs physics locally
  isLocalPredicted = false;

  // Visual smoothing: rendered position converges toward authoritative position
  visualPos: THREE.Vector3;
  visualAngle: number;
  private visualInitialized = false;

  private netBuffer: NetBufferEntry[] = [];
  private bodyMesh: THREE.Mesh;
  private bikeLight: THREE.PointLight;
  private scene: THREE.Scene;

  // Particles (delegated)
  private trailParticles: TrailParticles;
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
    this.speed = BIKE_SPEED;
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
    this.mesh.rotation.y = this.angle;
    scene.add(this.mesh);

    // Trail
    this.trail = new Trail(color, scene);

    // Trail spawn particles
    this.trailParticles = new TrailParticles(color, scene);
  }

  update(dt: number, input: PlayerInput, allTrails: Trail[], skipCollision = false): void {
    if (!this.alive) {
      this.deathParticles?.update(dt);
      return;
    }

    // Steering
    if (input.left) this.angle += TURN_RATE * dt;
    if (input.right) this.angle -= TURN_RATE * dt;

    // Boost
    this.boosting = input.boost && this.boostMeter > 0;
    if (this.boosting) {
      this.boostMeter = Math.max(0, this.boostMeter - BOOST_DRAIN * dt);
      this.boostRechargeTimer = BOOST_RECHARGE_DELAY;
    } else {
      if (this.boostRechargeTimer > 0) {
        this.boostRechargeTimer -= dt;
      } else {
        // Non-linear: recharge faster when meter is fuller
        const fillFraction = this.boostMeter / BOOST_MAX;
        const rate = BOOST_RECHARGE * (0.3 + 0.7 * fillFraction);
        this.boostMeter = Math.min(BOOST_MAX, this.boostMeter + rate * dt);
      }
    }
    const speedMul = this.boosting ? BOOST_MULTIPLIER : 1.0;

    // Forward direction
    const forward = new THREE.Vector3(
      Math.sin(this.angle),
      0,
      Math.cos(this.angle),
    );

    const oldPos: Vec2 = { x: this.position.x, z: this.position.z };

    // Move
    this.position.x += forward.x * this.speed * speedMul * dt;
    this.position.z += forward.z * this.speed * speedMul * dt;

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
      if (checkWallCollision(this.position.x, this.position.z)) {
        if (this.invulnerable) {
          // Clamp to arena boundary
          this.position.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.x));
          this.position.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.position.z));
        } else {
          this.die();
          return;
        }
      }
      if (this.invulnerable) {
        // Invulnerable: destroy enemy trails on contact
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

    // Update mesh — predicted bikes use visual smoothing for host corrections
    if (this.isLocalPredicted && this.visualInitialized) {
      const blend = 1 - Math.exp(-VISUAL_CORRECTION_RATE * dt);
      this.visualPos.lerp(this.position, blend);
      this.visualAngle += wrapAngle(this.angle - this.visualAngle) * blend;
      this.mesh.position.copy(this.visualPos);
      this.mesh.rotation.y = this.visualAngle;
    } else {
      this.visualPos.copy(this.position);
      this.visualAngle = this.angle;
      this.visualInitialized = true;
      this.mesh.position.copy(this.position);
      this.mesh.rotation.y = this.angle;
    }

    // Update trail at visual position so it always follows the rendered bike
    this.trail.addPoint(this.visualPos.x, this.position.y, this.visualPos.z);

    this.updatePitchTilt();

    // Spawn trail particles
    this.trailParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded);
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

    // Sync invulnerability visual effect
    this.syncInvulnerabilityFromNet(simBike.invulnerable, simBike.invulnerableTimer);

    // Update mesh
    this.visualPos.copy(this.position);
    this.visualAngle = this.angle;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.angle;
    this.updatePitchTilt();

    // Sync trail from simulation
    this.trail.syncFromSimTrail(simBike.trail.points);

    // Update particles
    this.trailParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded);

    // Effect visual update
    if (this.activeEffect) {
      this.activeEffect.onUpdate(this, dt);
    }
  }

  /** Sync visual state from Colyseus server schema (used in online mode) */
  syncFromServer(schemaBike: { x: number; y: number; z: number; angle: number; vy: number; alive: boolean; grounded: boolean; boostMeter: number; boosting: boolean; invulnerable: boolean; invulnerableTimer: number; doubleJumpCooldown: number; trail: Iterable<{ x: number; y: number; z: number }> & { length: number } }, dt: number): void {
    // Handle death transition
    if (!schemaBike.alive && this.alive) {
      this.alive = false;
      this.mesh.visible = false;
      this.expireActiveEffect();
      this.deathParticles = new DeathParticles(
        this.color, schemaBike.x, schemaBike.y, schemaBike.z, this.scene,
      );
    }

    if (!this.alive) {
      this.deathParticles?.update(dt);
      return;
    }

    // Smooth position toward server state
    const blend = 1 - Math.exp(-15 * dt);
    this.position.x += (schemaBike.x - this.position.x) * blend;
    this.position.y += (schemaBike.y - this.position.y) * blend;
    this.position.z += (schemaBike.z - this.position.z) * blend;

    let angleDiff = schemaBike.angle - this.angle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    this.angle += angleDiff * blend;

    // Copy non-positional state
    this.vy = schemaBike.vy;
    this.grounded = schemaBike.grounded;
    this.boosting = schemaBike.boosting;
    this.boostMeter = schemaBike.boostMeter;
    this.doubleJumpCooldown = schemaBike.doubleJumpCooldown;
    this.doubleJumpReady = schemaBike.doubleJumpCooldown <= 0;

    // Sync invulnerability visual effect
    this.syncInvulnerabilityFromNet(schemaBike.invulnerable, schemaBike.invulnerableTimer);

    // Update mesh
    this.visualPos.copy(this.position);
    this.visualAngle = this.angle;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.angle;
    this.updatePitchTilt();

    // Sync trail from schema trail array (only when length changes)
    const schemaTrailLen = schemaBike.trail.length;
    if (schemaTrailLen !== this.trail.points.length) {
      const points: Array<{ x: number; y: number; z: number }> = [];
      for (const tp of schemaBike.trail) {
        points.push({ x: tp.x, y: tp.y, z: tp.z });
      }
      this.trail.syncFromSimTrail(points);
    }

    // Update particles
    this.trailParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded);

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

  /** Apply pitch tilt to the body mesh based on vertical velocity. */
  private updatePitchTilt(): void {
    if (!this.grounded) {
      this.bodyMesh.rotation.x = -(this.vy / JUMP_INITIAL_VY) * 0.2;
    } else {
      this.bodyMesh.rotation.x = 0;
    }
  }

  /** Sync optional fields (invulnerability, double-jump) from server state. */
  private syncOptionalNetState(state: NetState): void {
    if (state.invulnerable !== undefined) {
      this.syncInvulnerabilityFromNet(state.invulnerable, state.invulnerableTimer ?? 0);
    }
    if (state.doubleJumpCooldown !== undefined) {
      this.doubleJumpCooldown = state.doubleJumpCooldown;
      this.doubleJumpReady = state.doubleJumpCooldown <= 0;
    }
  }

  applyNetState(state: NetState): void {
    // Death is always authoritative from host
    if (!state.alive && this.alive) {
      this.die();
      return;
    }

    // Client-side predicted bike: reconcile with host state instead of buffering
    if (this.isLocalPredicted) {
      const dx = state.x - this.position.x;
      const dy = state.y - this.position.y;
      const dz = state.z - this.position.z;
      const error = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (error > 10) {
        // Large disagreement: snap to host
        this.position.set(state.x, state.y, state.z);
        this.angle = state.angle;
        this.visualPos.copy(this.position);
        this.visualAngle = this.angle;
      } else if (error > 0.1) {
        // Small correction: nudge toward host (visual smoothing handles the rest)
        const correction = 0.3;
        this.position.x += dx * correction;
        this.position.y += dy * correction;
        this.position.z += dz * correction;

        this.angle += wrapAngle(state.angle - this.angle) * correction;
      }

      // Always sync non-positional state from host
      this.vy = state.vy;
      this.grounded = state.grounded;
      this.boosting = state.boosting;
      this.boostMeter = state.boostMeter;
      this.syncOptionalNetState(state);
      return;
    }

    // --- Normal (non-predicted) path for remote bikes ---

    // First state: snap immediately so bike appears at correct position
    if (this.netBuffer.length === 0) {
      this.position.set(state.x, state.y, state.z);
      this.angle = state.angle;
      this.visualPos.copy(this.position);
      this.visualAngle = this.angle;
      this.visualInitialized = true;
      this.mesh.position.copy(this.position);
      this.mesh.rotation.y = this.angle;
    }
    // Push to interpolation buffer
    this.netBuffer.push({
      x: state.x, z: state.z, y: state.y, angle: state.angle,
      vy: state.vy, grounded: state.grounded,
      speed: state.speed ?? BIKE_SPEED, boosting: state.boosting,
      tick: state.tick,
      time: performance.now(),
    });
    if (this.netBuffer.length > NET_BUFFER_SIZE) {
      this.netBuffer.shift();
    }
    this.boosting = state.boosting;
    this.boostMeter = state.boostMeter;
    this.syncOptionalNetState(state);
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
      } else if (renderTick > b.tick) {
        // Extrapolation: renderTick ahead of buffer, no newer state yet.
        const extraTicks = renderTick - b.tick;
        if (extraTicks <= EXTRAP_MAX_TICKS) {
          const cappedSec = extraTicks * (NET_TICK_DURATION_MS / 1000);
          this.position.x = b.x + Math.sin(b.angle) * b.speed * cappedSec;
          this.position.z = b.z + Math.cos(b.angle) * b.speed * cappedSec;
          this.position.y = b.y;
          this.angle = b.angle;
        }
        // Beyond EXTRAP_MAX_TICKS: freeze at last known position (already set)
        this.vy = b.vy;
        this.grounded = b.grounded;
      } else {
        // renderTick behind buffer — snap to earliest known state
        this.position.x = a.x;
        this.position.z = a.z;
        this.position.y = a.y;
        this.angle = a.angle;
        this.vy = a.vy;
        this.grounded = a.grounded;
      }
    } else if (this.netBuffer.length >= 2) {
      // Fallback: time-based interpolation when renderTick not available
      const a = this.netBuffer[0];
      const b = this.netBuffer[1];
      const duration = b.time - a.time;
      const elapsed = performance.now() - a.time;
      const t = duration > 0 ? Math.min(elapsed / duration, 1.5) : 1.0;

      const clamped = Math.min(t, 1.0);
      this.position.x = a.x + (b.x - a.x) * clamped;
      this.position.z = a.z + (b.z - a.z) * clamped;
      this.position.y = a.y + (b.y - a.y) * clamped;
      this.angle = a.angle + wrapAngle(b.angle - a.angle) * clamped;

      if (t >= 1.0 && this.netBuffer.length >= 3) {
        this.netBuffer.shift();
      }
    }
    // With 0 or 1 state, position/angle are already set from applyNetState

    // Visual smoothing: blend rendered position toward authoritative position
    if (this.visualInitialized) {
      const blend = 1 - Math.exp(-VISUAL_CORRECTION_RATE * dt);
      this.visualPos.lerp(this.position, blend);
      this.visualAngle += wrapAngle(this.angle - this.visualAngle) * blend;
    } else {
      this.visualPos.copy(this.position);
      this.visualAngle = this.angle;
      this.visualInitialized = true;
    }

    this.mesh.position.copy(this.visualPos);
    this.mesh.rotation.y = this.visualAngle;
    this.updatePitchTilt();

    // Trail follows visual position so it always ends where the bike renders
    this.trail.addPoint(this.visualPos.x, this.position.y, this.visualPos.z);

    // Effect visual update (for remote bikes)
    if (this.activeEffect) {
      this.activeEffect.onUpdate(this, dt);
    }

    this.trailParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded);
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
    this.netBuffer = [];
    this.visualPos.copy(this.position);
    this.visualAngle = this.angle;
    this.visualInitialized = false;
    this.mesh.visible = true;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.angle;
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
    this.trail.dispose(scene);
    if (this.deathParticles) {
      this.deathParticles.dispose(scene);
    }
  }
}
