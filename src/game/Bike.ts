import * as THREE from 'three';
import {
  BIKE_SPEED, TURN_RATE, TRAIL_HEIGHT,
  JUMP_INITIAL_VY, GRAVITY, JUMP_COOLDOWN,
  BOOST_MULTIPLIER, BOOST_MAX, BOOST_DRAIN, BOOST_RECHARGE, BOOST_RECHARGE_DELAY,
  NET_TICK_DURATION_MS, VISUAL_CORRECTION_RATE,
  ARENA_HALF, INVULNERABILITY_DURATION, TRAIL_DESTROY_RADIUS,
  DOUBLE_JUMP_COOLDOWN,
} from './constants';
import { Trail } from './Trail';
import { PlayerInput } from './Input';
import { checkTrailCollision, checkTrailCollisionDetailed, checkWallCollision } from './Collision';
import { Vec2 } from '../types';

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

  // Invulnerability
  invulnerable = false;
  invulnerableTimer = 0;
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

  private netBuffer: Array<{ x: number; z: number; y: number; angle: number; vy: number; grounded: boolean; tick: number; time: number }> = [];
  private bodyMesh: THREE.Mesh;
  private scene: THREE.Scene;

  // Particles
  private trailParticles: THREE.Points;
  private particlePositions: Float32Array;
  private particleSpeeds: Float32Array;
  private particleLifetimes: Float32Array;
  private maxParticles = 50;

  // Death particles
  private deathParticles: THREE.Points | null = null;
  private deathPositions: Float32Array | null = null;
  private deathVelocities: Float32Array | null = null;
  private deathLifetimes: Float32Array | null = null;
  private deathMaxParticles = 80;

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
    const bikeLight = new THREE.PointLight(new THREE.Color(color), 2, 15);
    bikeLight.position.set(0, 1, 0);
    this.mesh.add(bikeLight);

    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.angle;
    scene.add(this.mesh);

    // Trail
    this.trail = new Trail(color, scene);

    // Trail spawn particles
    this.particlePositions = new Float32Array(this.maxParticles * 3);
    this.particleSpeeds = new Float32Array(this.maxParticles * 3);
    this.particleLifetimes = new Float32Array(this.maxParticles);
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: new THREE.Color(color),
      size: 0.3,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.trailParticles = new THREE.Points(particleGeo, particleMat);
    this.trailParticles.frustumCulled = false;
    scene.add(this.trailParticles);
  }

  update(dt: number, input: PlayerInput, allTrails: Trail[], skipCollision = false): void {
    if (!this.alive) {
      this.updateDeathParticles(dt);
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

    // Invulnerability timer
    if (this.invulnerable) {
      this.invulnerableTimer -= dt;
      if (this.invulnerableTimer <= 0) {
        this.invulnerable = false;
        this.invulnerableTimer = 0;
        this.restoreNormalVisuals();
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

    // Rainbow visual update while invulnerable
    if (this.invulnerable) {
      this.updateInvulnerabilityVisual();
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

    // Pitch tilt during jump
    if (!this.grounded) {
      const pitchFactor = this.vy / JUMP_INITIAL_VY;
      this.bodyMesh.rotation.x = -pitchFactor * 0.2;
    } else {
      this.bodyMesh.rotation.x = 0;
    }

    // Spawn trail particles
    this.updateTrailParticles(dt);
  }

  private updateTrailParticles(dt: number): void {
    const posArr = this.particlePositions;
    const spdArr = this.particleSpeeds;
    const lifeArr = this.particleLifetimes;

    // Update existing
    for (let i = 0; i < this.maxParticles; i++) {
      if (lifeArr[i] > 0) {
        lifeArr[i] -= dt;
        posArr[i * 3] += spdArr[i * 3] * dt;
        posArr[i * 3 + 1] += spdArr[i * 3 + 1] * dt;
        posArr[i * 3 + 2] += spdArr[i * 3 + 2] * dt;
      }
    }

    // Spawn new at bike rear
    if (this.grounded || this.position.y < 1) {
      for (let i = 0; i < this.maxParticles; i++) {
        if (lifeArr[i] <= 0) {
          const rear = -1.0;
          const rx = this.position.x - Math.sin(this.angle) * rear;
          const rz = this.position.z - Math.cos(this.angle) * rear;
          posArr[i * 3] = rx + (Math.random() - 0.5) * 0.5;
          posArr[i * 3 + 1] = Math.random() * TRAIL_HEIGHT;
          posArr[i * 3 + 2] = rz + (Math.random() - 0.5) * 0.5;
          spdArr[i * 3] = (Math.random() - 0.5) * 2;
          spdArr[i * 3 + 1] = Math.random() * 3;
          spdArr[i * 3 + 2] = (Math.random() - 0.5) * 2;
          lifeArr[i] = 0.3 + Math.random() * 0.5;
          break; // one per frame
        }
      }
    }

    (this.trailParticles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  grantInvulnerability(): void {
    this.invulnerable = true;
    this.invulnerableTimer = INVULNERABILITY_DURATION;
  }

  private updateInvulnerabilityVisual(): void {
    const t = performance.now() / 1000;
    const hue = (t * 4) % 1.0;
    const blink = Math.sin(t * 5 * Math.PI * 2) > 0 ? 1.0 : 0.6;
    const color = new THREE.Color().setHSL(hue, 1.0, 0.5 * blink);

    const mat = this.bodyMesh.material as THREE.MeshStandardMaterial;
    mat.color.copy(color);
    mat.emissive.copy(color);
    mat.emissiveIntensity = 0.8;

    // Update the existing bike point light (child index 3)
    const bikeLight = this.mesh.children.find(c => c instanceof THREE.PointLight) as THREE.PointLight | undefined;
    if (bikeLight) {
      bikeLight.color.copy(color);
      bikeLight.intensity = 4;
    }
  }

  private restoreNormalVisuals(): void {
    const baseColor = new THREE.Color(this.color);
    const mat = this.bodyMesh.material as THREE.MeshStandardMaterial;
    mat.color.copy(baseColor);
    mat.emissive.copy(baseColor);
    mat.emissiveIntensity = 0.3;

    const bikeLight = this.mesh.children.find(c => c instanceof THREE.PointLight) as THREE.PointLight | undefined;
    if (bikeLight) {
      bikeLight.color.copy(baseColor);
      bikeLight.intensity = 2;
    }
  }

  private die(): void {
    this.alive = false;
    this.mesh.visible = false;
    this.invulnerable = false;
    this.invulnerableTimer = 0;
    this.spawnDeathParticles();
  }

  private spawnDeathParticles(): void {
    this.deathPositions = new Float32Array(this.deathMaxParticles * 3);
    this.deathVelocities = new Float32Array(this.deathMaxParticles * 3);
    this.deathLifetimes = new Float32Array(this.deathMaxParticles);

    for (let i = 0; i < this.deathMaxParticles; i++) {
      this.deathPositions[i * 3] = this.position.x + (Math.random() - 0.5) * 2;
      this.deathPositions[i * 3 + 1] = this.position.y + Math.random() * 2;
      this.deathPositions[i * 3 + 2] = this.position.z + (Math.random() - 0.5) * 2;
      this.deathVelocities[i * 3] = (Math.random() - 0.5) * 20;
      this.deathVelocities[i * 3 + 1] = Math.random() * 15;
      this.deathVelocities[i * 3 + 2] = (Math.random() - 0.5) * 20;
      this.deathLifetimes[i] = 0.5 + Math.random() * 1.0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.deathPositions, 3));
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color(this.color),
      size: 0.5,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.deathParticles = new THREE.Points(geo, mat);
    this.deathParticles.frustumCulled = false;
    this.scene.add(this.deathParticles);
  }

  private updateDeathParticles(dt: number): void {
    if (!this.deathParticles || !this.deathPositions || !this.deathVelocities || !this.deathLifetimes) return;

    let allDead = true;
    for (let i = 0; i < this.deathMaxParticles; i++) {
      if (this.deathLifetimes[i] > 0) {
        allDead = false;
        this.deathLifetimes[i] -= dt;
        this.deathPositions[i * 3] += this.deathVelocities[i * 3] * dt;
        this.deathPositions[i * 3 + 1] += this.deathVelocities[i * 3 + 1] * dt;
        this.deathPositions[i * 3 + 2] += this.deathVelocities[i * 3 + 2] * dt;
        this.deathVelocities[i * 3 + 1] -= GRAVITY * dt;
      }
    }

    (this.deathParticles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.deathParticles.material as THREE.PointsMaterial).opacity = allDead ? 0 : 0.8;
  }

  applyNetState(state: { x: number; z: number; y: number; angle: number; alive: boolean; vy: number; grounded: boolean; boostMeter: number; boosting: boolean; invulnerable?: boolean; invulnerableTimer?: number; doubleJumpCooldown?: number; tick: number }): void {
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
        const wasInvulnerable = this.invulnerable;
        this.invulnerable = state.invulnerable;
        this.invulnerableTimer = state.invulnerableTimer ?? 0;
        if (!wasInvulnerable && this.invulnerable) this.updateInvulnerabilityVisual();
        if (wasInvulnerable && !this.invulnerable) this.restoreNormalVisuals();
      }
      if (state.doubleJumpCooldown !== undefined) {
        this.doubleJumpCooldown = state.doubleJumpCooldown;
        this.doubleJumpReady = state.doubleJumpCooldown <= 0;
      }
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
      const wasInvulnerable = this.invulnerable;
      this.invulnerable = state.invulnerable;
      this.invulnerableTimer = state.invulnerableTimer ?? 0;
      if (!wasInvulnerable && this.invulnerable) this.updateInvulnerabilityVisual();
      if (wasInvulnerable && !this.invulnerable) this.restoreNormalVisuals();
    }
    if (state.doubleJumpCooldown !== undefined) {
      this.doubleJumpCooldown = state.doubleJumpCooldown;
      this.doubleJumpReady = state.doubleJumpCooldown <= 0;
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
      } else if (renderTick > b.tick) {
        // Extrapolation: renderTick ahead of buffer, no newer state yet.
        // Use boost-aware speed; cap at 1 tick to avoid overshooting turns.
        const extraTicks = renderTick - b.tick;
        const cappedSec = Math.min(extraTicks * (NET_TICK_DURATION_MS / 1000), NET_TICK_DURATION_MS / 1000);
        const speed = this.boosting ? BIKE_SPEED * BOOST_MULTIPLIER : BIKE_SPEED;
        this.position.x = b.x + Math.sin(b.angle) * speed * cappedSec;
        this.position.z = b.z + Math.cos(b.angle) * speed * cappedSec;
        this.position.y = b.y;
        this.angle = b.angle;
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

      this.position.x = a.x + (b.x - a.x) * Math.min(t, 1.0);
      this.position.z = a.z + (b.z - a.z) * Math.min(t, 1.0);
      this.position.y = a.y + (b.y - a.y) * Math.min(t, 1.0);

      let da = b.angle - a.angle;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      this.angle = a.angle + da * Math.min(t, 1.0);

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

    // Pitch tilt during jump
    if (!this.grounded) {
      const pitchFactor = this.vy / JUMP_INITIAL_VY;
      this.bodyMesh.rotation.x = -pitchFactor * 0.2;
    } else {
      this.bodyMesh.rotation.x = 0;
    }

    // Rainbow visual update while invulnerable (for remote bikes)
    if (this.invulnerable) {
      this.updateInvulnerabilityVisual();
    }

    this.updateTrailParticles(dt);
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
    this.invulnerable = false;
    this.invulnerableTimer = 0;
    this.lastTrailDestruction = null;
    this.doubleJumpReady = true;
    this.doubleJumpCooldown = 0;
    this.usedDoubleJumpThisAirborne = false;
    this.boostRechargeTimer = 0;
    this.restoreNormalVisuals();
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
      this.scene.remove(this.deathParticles);
      this.deathParticles.geometry.dispose();
      (this.deathParticles.material as THREE.PointsMaterial).dispose();
      this.deathParticles = null;
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    scene.remove(this.trailParticles);
    this.trail.dispose(scene);
    if (this.deathParticles) {
      scene.remove(this.deathParticles);
      this.deathParticles.geometry.dispose();
      (this.deathParticles.material as THREE.PointsMaterial).dispose();
    }
  }
}
