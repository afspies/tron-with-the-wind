import * as THREE from 'three';
import {
  BIKE_SPEED, TURN_RATE,
  JUMP_INITIAL_VY, GRAVITY, JUMP_COOLDOWN,
  BOOST_MULTIPLIER, BOOST_MAX, BOOST_DRAIN, BOOST_RECHARGE, BOOST_RECHARGE_DELAY,
  NET_TICK_DURATION_MS, VISUAL_CORRECTION_RATE,
  ARENA_HALF, TRAIL_DESTROY_RADIUS,
  DOUBLE_JUMP_COOLDOWN,
  FLIGHT_PITCH_RATE, FLIGHT_PITCH_RETURN_RATE, FLIGHT_MAX_PITCH,
  FLIGHT_THRUST, FLIGHT_AIR_TURN_MULT, FLIGHT_BOOST_DRAIN_MULT,
  FLIGHT_LANDING_MAX_PITCH,
} from '@tron/shared';
import type { Vec2, PlayerInput } from '@tron/shared';
import type { SimBike } from '@tron/game-core';
import { Trail } from './Trail';
import { checkTrailCollision, checkTrailCollisionDetailed, checkWallCollision } from './Collision';
import type { PowerUpEffect } from './powerups/PowerUpEffect';
import { createEffect } from './powerups/PowerUpRegistry';
import { TrailParticles, DeathParticles } from './BikeParticles';

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

  // Flight
  pitch = 0;
  flying = false;

  terrainHeightFn: (x: number, z: number, currentY: number) => number = () => 0;
  terrainCeilingFn: (x: number, z: number, currentY: number) => number = () => Infinity;

  // Client-side prediction: local player's bike runs physics locally
  isLocalPredicted = false;

  // Visual smoothing: rendered position converges toward authoritative position
  visualPos: THREE.Vector3;
  visualAngle: number;
  private visualInitialized = false;

  private netBuffer: Array<{ x: number; z: number; y: number; angle: number; vy: number; grounded: boolean; pitch: number; flying: boolean; tick: number; time: number }> = [];
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
    const turnRate = this.flying ? TURN_RATE * FLIGHT_AIR_TURN_MULT : TURN_RATE;
    if (input.left) this.angle += turnRate * dt;
    if (input.right) this.angle -= turnRate * dt;

    // Boost
    this.boosting = input.boost && this.boostMeter > 0;
    this.flying = !this.grounded && this.usedDoubleJumpThisAirborne && this.boosting;

    if (this.boosting) {
      const drain = this.flying ? BOOST_DRAIN * FLIGHT_BOOST_DRAIN_MULT : BOOST_DRAIN;
      this.boostMeter = Math.max(0, this.boostMeter - drain * dt);
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

    // Pitch update
    if (this.flying) {
      this.pitch = Math.min(FLIGHT_MAX_PITCH, this.pitch + FLIGHT_PITCH_RATE * dt);
    } else if (!this.grounded && this.pitch > 0) {
      this.pitch = Math.max(0, this.pitch - FLIGHT_PITCH_RETURN_RATE * dt);
    } else if (this.grounded) {
      this.pitch = 0;
    }

    // Forward direction
    const forward = new THREE.Vector3(
      Math.sin(this.angle),
      0,
      Math.cos(this.angle),
    );

    const oldPos: Vec2 = { x: this.position.x, z: this.position.z };

    // Move
    if (this.flying) {
      const horizSpeed = BIKE_SPEED * BOOST_MULTIPLIER * Math.cos(this.pitch);
      this.position.x += forward.x * horizSpeed * dt;
      this.position.z += forward.z * horizSpeed * dt;
      this.vy += FLIGHT_THRUST * Math.sin(this.pitch) * dt;
    } else if (!this.grounded && this.pitch > 0) {
      const horizSpeed = BIKE_SPEED * Math.cos(this.pitch);
      this.position.x += forward.x * horizSpeed * dt;
      this.position.z += forward.z * horizSpeed * dt;
    } else {
      const speedMul = this.boosting ? BOOST_MULTIPLIER : 1.0;
      this.position.x += forward.x * this.speed * speedMul * dt;
      this.position.z += forward.z * this.speed * speedMul * dt;
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

      // Ceiling check: prevent passing through platform from below
      const ceiling = this.terrainCeilingFn(this.position.x, this.position.z, this.position.y);
      if (this.position.y >= ceiling) {
        this.position.y = ceiling;
        if (this.vy > 0) this.vy = 0;
      }

      const groundY = this.terrainHeightFn(this.position.x, this.position.z, this.position.y);
      if (this.position.y <= groundY) {
        if (this.pitch > FLIGHT_LANDING_MAX_PITCH) {
          this.die();
          return;
        }
        this.position.y = groundY;
        this.vy = 0;
        this.grounded = true;
        this.pitch = 0;
        this.flying = false;
        this.jumpCooldown = JUMP_COOLDOWN;
      }
    }

    // Edge detection: if grounded but terrain dropped away, become airborne
    if (this.grounded) {
      const groundY = this.terrainHeightFn(this.position.x, this.position.z, this.position.y);
      if (this.position.y > groundY + 0.1) {
        this.grounded = false;
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

    // Update trail (follows bike Y for 3D arcs)
    this.trail.addPoint(this.position.x, this.position.y, this.position.z);

    // Update mesh — predicted bikes use visual smoothing for host corrections
    if (this.isLocalPredicted && this.visualInitialized) {
      const blend = 1 - Math.exp(-VISUAL_CORRECTION_RATE * dt);
      this.visualPos.lerp(this.position, blend);
      let angleDiff = this.angle - this.visualAngle;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      this.visualAngle += angleDiff * blend;
      this.mesh.position.copy(this.visualPos);
      this.mesh.rotation.y = this.visualAngle;
    } else {
      this.visualPos.copy(this.position);
      this.visualAngle = this.angle;
      this.visualInitialized = true;
      this.mesh.position.copy(this.position);
      this.mesh.rotation.y = this.angle;
    }

    this.updateBodyPitch();

    // Spawn trail particles
    this.trailParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded, this.flying);
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
    this.pitch = simBike.pitch;
    this.flying = simBike.flying;

    // Sync invulnerability visual effect
    this.syncInvulnerabilityFromNet(simBike.invulnerable, simBike.invulnerableTimer);

    // Update mesh
    this.visualPos.copy(this.position);
    this.visualAngle = this.angle;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.angle;

    this.updateBodyPitch();

    // Sync trail from simulation
    this.trail.syncFromSimTrail(simBike.trail.points);

    // Update particles
    this.trailParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded, this.flying);

    // Effect visual update
    if (this.activeEffect) {
      this.activeEffect.onUpdate(this, dt);
    }
  }

  /** Sync visual state from Colyseus server schema (used in online mode) */
  syncFromServer(schemaBike: { x: number; y: number; z: number; angle: number; vy: number; alive: boolean; grounded: boolean; boostMeter: number; boosting: boolean; invulnerable: boolean; invulnerableTimer: number; doubleJumpCooldown: number; pitch: number; flying: boolean; trail: Iterable<{ x: number; y: number; z: number }> & { length: number } }, dt: number): void {
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
    this.flying = schemaBike.flying;

    this.pitch += (schemaBike.pitch - this.pitch) * blend;

    // Sync invulnerability visual effect
    this.syncInvulnerabilityFromNet(schemaBike.invulnerable, schemaBike.invulnerableTimer);

    // Update mesh
    this.visualPos.copy(this.position);
    this.visualAngle = this.angle;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.angle;

    this.updateBodyPitch();

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
    this.trailParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded, this.flying);

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

  private updateBodyPitch(): void {
    if (this.flying || this.pitch > 0.01) {
      this.bodyMesh.rotation.x = -this.pitch;
    } else if (!this.grounded) {
      this.bodyMesh.rotation.x = -(this.vy / JUMP_INITIAL_VY) * 0.2;
    } else {
      this.bodyMesh.rotation.x = 0;
    }
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

  applyNetState(state: { x: number; z: number; y: number; angle: number; alive: boolean; vy: number; grounded: boolean; boostMeter: number; boosting: boolean; invulnerable?: boolean; invulnerableTimer?: number; doubleJumpCooldown?: number; pitch?: number; flying?: boolean; tick: number }): void {
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

        let angleDiff = state.angle - this.angle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        this.angle += angleDiff * correction;
      }

      // Always sync non-positional state from host
      this.vy = state.vy;
      this.grounded = state.grounded;
      this.boosting = state.boosting;
      this.boostMeter = state.boostMeter;
      if (state.invulnerable !== undefined) {
        this.syncInvulnerabilityFromNet(state.invulnerable, state.invulnerableTimer ?? 0);
      }
      if (state.doubleJumpCooldown !== undefined) {
        this.doubleJumpCooldown = state.doubleJumpCooldown;
        this.doubleJumpReady = state.doubleJumpCooldown <= 0;
      }
      if (state.pitch !== undefined) this.pitch = state.pitch;
      if (state.flying !== undefined) this.flying = state.flying;
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
    // Push to interpolation buffer (keep last 3 for smooth interpolation)
    this.netBuffer.push({
      x: state.x, z: state.z, y: state.y, angle: state.angle,
      vy: state.vy, grounded: state.grounded,
      pitch: state.pitch ?? 0, flying: state.flying ?? false,
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
    if (state.invulnerable !== undefined) {
      this.syncInvulnerabilityFromNet(state.invulnerable, state.invulnerableTimer ?? 0);
    }
    if (state.doubleJumpCooldown !== undefined) {
      this.doubleJumpCooldown = state.doubleJumpCooldown;
      this.doubleJumpReady = state.doubleJumpCooldown <= 0;
    }
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

        let da = b.angle - a.angle;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        this.angle = a.angle + da * t;

        this.vy = a.vy + (b.vy - a.vy) * t;
        this.grounded = t < 0.5 ? a.grounded : b.grounded;
        this.pitch = a.pitch + (b.pitch - a.pitch) * t;
        this.flying = t < 0.5 ? a.flying : b.flying;
      } else if (renderTick > b.tick) {
        // Extrapolation: renderTick ahead of buffer, no newer state yet.
        // Use boost-aware speed; cap at 1 tick to avoid overshooting turns.
        const extraTicks = renderTick - b.tick;
        const cappedSec = Math.min(extraTicks * (NET_TICK_DURATION_MS / 1000), NET_TICK_DURATION_MS / 1000);
        const cosPitch = b.flying ? Math.cos(b.pitch) : 1;
        const speed = this.boosting ? BIKE_SPEED * BOOST_MULTIPLIER : BIKE_SPEED;
        this.position.x = b.x + Math.sin(b.angle) * speed * cosPitch * cappedSec;
        this.position.z = b.z + Math.cos(b.angle) * speed * cosPitch * cappedSec;
        this.position.y = b.y;
        this.angle = b.angle;
        this.vy = b.vy;
        this.grounded = b.grounded;
        this.pitch = b.pitch;
        this.flying = b.flying;
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

      let da = b.angle - a.angle;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      this.angle = a.angle + da * tClamped;

      this.pitch = a.pitch + (b.pitch - a.pitch) * tClamped;
      this.flying = tClamped < 0.5 ? a.flying : b.flying;

      if (t >= 1.0 && this.netBuffer.length >= 3) {
        this.netBuffer.shift();
      }
    }
    // With 0 or 1 state, position/angle are already set from applyNetState

    // Visual smoothing: blend rendered position toward authoritative position
    if (this.visualInitialized) {
      const blend = 1 - Math.exp(-VISUAL_CORRECTION_RATE * dt);
      this.visualPos.lerp(this.position, blend);

      let angleDiff = this.angle - this.visualAngle;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      this.visualAngle += angleDiff * blend;
    } else {
      this.visualPos.copy(this.position);
      this.visualAngle = this.angle;
      this.visualInitialized = true;
    }

    this.mesh.position.copy(this.visualPos);
    this.mesh.rotation.y = this.visualAngle;

    this.updateBodyPitch();

    // Effect visual update (for remote bikes)
    if (this.activeEffect) {
      this.activeEffect.onUpdate(this, dt);
    }

    this.trailParticles.update(dt, this.position.x, this.position.y, this.position.z, this.angle, this.grounded, this.flying);
  }

  /** Position for camera targeting — uses smoothed visual position when available */
  get renderPosition(): THREE.Vector3 {
    return this.visualInitialized ? this.visualPos : this.position;
  }

  get renderAngle(): number {
    return this.visualInitialized ? this.visualAngle : this.angle;
  }

  reset(x: number, z: number, angle: number): void {
    this.position.set(x, this.terrainHeightFn(x, z, 999), z);
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
    this.pitch = 0;
    this.flying = false;
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
