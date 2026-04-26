import * as THREE from 'three';
import {
  SurfaceType,
  BIKE_SPEED,
  JUMP_INITIAL_VY,
  BOOST_MULTIPLIER, BOOST_MAX,
  DRIFT_SPEED_MULTIPLIER,
  wrapAngle,
} from '@tron/shared';
import type { BikeSnapshot, Vec3 } from '@tron/shared';
import type { SimBike } from '@tron/game-core';
import { getArenaSurfaceInfo } from '@tron/game-core';
import { Trail } from './Trail';
import type { PowerUpEffect } from './powerups/PowerUpEffect';
import { createEffect } from './powerups/PowerUpRegistry';
import { TrailParticles, DriftParticles, DeathParticles } from './BikeParticles';

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

  // Wall driving
  surfaceType: SurfaceType = SurfaceType.Floor;
  surfaceNormal: Vec3 = { x: 0, y: 1, z: 0 };
  forward: Vec3 = { x: 0, y: 0, z: 1 };
  private targetQuaternion = new THREE.Quaternion();
  private currentQuaternion = new THREE.Quaternion();

  // Rendered position/angle
  visualPos: THREE.Vector3;
  visualAngle: number;
  private visualInitialized = false;

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
    this.targetQuaternion.setFromEuler(new THREE.Euler(0, this.angle + Math.PI, 0));
    this.currentQuaternion.copy(this.targetQuaternion);
    this.mesh.quaternion.copy(this.currentQuaternion);
    this.forward = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
    scene.add(this.mesh);

    // Trail
    this.trail = new Trail(color, scene);

    // Trail spawn particles
    this.trailParticles = new TrailParticles(color, scene);

    // Drift spark particles
    this.driftParticles = new DriftParticles(color, scene);
  }

  grantInvulnerability(): void {
    const effect = createEffect('invulnerability');
    if (effect) {
      effect.onGrant(this);
    }
  }

  /** Returns true if the bike just died and visual update should stop. */
  private handleDeathTransition(simBike: SimBike, dt: number): boolean {
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
      return true;
    }
    return false;
  }

  /** Copy core physics state from a SimBike. */
  private copyPhysicsState(simBike: SimBike): void {
    this.position.set(simBike.position.x, simBike.position.y, simBike.position.z);
    this.angle = simBike.angle;
    this.speed = simBike.speed;
    this.vy = simBike.vy;
    this.grounded = simBike.grounded;
    this.boosting = simBike.boosting;
    this.boostMeter = simBike.boostMeter;
    this.drifting = simBike.drifting;
    this.velocityAngle = simBike.velocityAngle;
    this.vx = simBike.vx;
    this.vz = simBike.vz;
    this.pitch = simBike.pitch;
    this.flying = simBike.flying;
    this.surfaceType = simBike.surfaceType;
    this.forward = { x: simBike.forward.x, y: simBike.forward.y, z: simBike.forward.z };
    this.surfaceNormal = { x: simBike.surfaceNormal.x, y: simBike.surfaceNormal.y, z: simBike.surfaceNormal.z };
  }

  /** Update mesh visuals: orientation, pitch, lean, effect. */
  private updateVisuals(dt: number): void {
    this.updateMeshOrientation(dt);
    this.updateBodyPitch();
    this.updateDriftLean();
    if (this.activeEffect) {
      this.activeEffect.onUpdate(this, dt);
    }
  }

  /** Update particle systems at the given visual position/angle. */
  private updateParticles(dt: number, px: number, py: number, pz: number, angle: number): void {
    this.trailParticles.update(dt, px, py, pz, angle, this.grounded, this.flying, this.forward, this.surfaceNormal);
    this.driftParticles.update(dt, px, py, pz, angle, this.grounded, this.drifting);
  }

  /** Sync visual state from headless simulation bike (used in quickplay). */
  syncFromSim(simBike: SimBike, dt: number): void {
    if (this.handleDeathTransition(simBike, dt)) return;

    this.copyPhysicsState(simBike);
    this.jumpCooldown = simBike.jumpCooldown;
    this.doubleJumpReady = simBike.doubleJumpReady;
    this.doubleJumpCooldown = simBike.doubleJumpCooldown;
    this.usedDoubleJumpThisAirborne = simBike.usedDoubleJumpThisAirborne;
    this.boostRechargeTimer = simBike.boostRechargeTimer;
    this.driftTimer = simBike.driftTimer;

    this.syncInvulnerabilityFromNet(simBike.invulnerable, simBike.invulnerableTimer);

    this.visualPos.copy(this.position);
    this.visualAngle = this.angle;
    this.mesh.position.copy(this.position);

    this.updateVisuals(dt);
    this.trail.syncFromSimTrail(simBike.trail.points);
    this.updateParticles(dt, this.position.x, this.position.y, this.position.z, this.angle);
  }

  /** Apply an interpolated authoritative network render state. */
  applyRenderState(state: BikeSnapshot, dt: number): void {
    if (!state.alive) {
      if (this.alive) {
        this.alive = false;
        this.mesh.visible = false;
        this.expireActiveEffect();
        this.deathParticles = new DeathParticles(this.color, state.x, state.y, state.z, this.scene);
      }
      this.deathParticles?.update(dt);
      return;
    }

    if (!this.alive) {
      this.deathParticles?.update(dt);
      return;
    }

    this.position.set(state.x, state.y, state.z);
    this.angle = state.angle;
    this.vy = state.vy;
    this.grounded = state.grounded;
    this.boostMeter = state.boostMeter;
    this.boosting = state.boosting;
    this.doubleJumpCooldown = state.doubleJumpCooldown;
    this.doubleJumpReady = state.doubleJumpCooldown <= 0;
    this.drifting = state.drifting;
    this.velocityAngle = state.velocityAngle;
    this.vx = state.vx;
    this.vz = state.vz;
    this.pitch = state.pitch;
    this.flying = state.flying;
    this.surfaceType = state.surfaceType;
    this.forward = { x: state.forwardX, y: state.forwardY, z: state.forwardZ };

    this.syncInvulnerabilityFromNet(state.invulnerable, state.invulnerableTimer);

    this.visualPos.copy(this.position);
    this.visualAngle = this.angle;
    this.visualInitialized = true;
    this.mesh.visible = true;
    this.mesh.position.copy(this.visualPos);

    this.updateVisuals(dt);
    this.updateParticles(dt, this.visualPos.x, this.visualPos.y, this.visualPos.z, this.visualAngle);
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
    if (this.flying || Math.abs(this.pitch) > 0.01) {
      this.bodyMesh.rotation.x = this.pitch;
    } else if (!this.grounded) {
      this.bodyMesh.rotation.x = -(this.vy / JUMP_INITIAL_VY) * 0.2;
    } else {
      this.bodyMesh.rotation.x = 0;
    }
  }

  /** Compute mesh orientation from surface state using continuous surface normal. */
  private updateMeshOrientation(dt: number): void {
    // Always recompute surfaceNormal from physics position (works for both floor and walls)
    const surfInfo = getArenaSurfaceInfo({
      x: this.position.x, y: this.position.y, z: this.position.z,
    });
    this.surfaceNormal = surfInfo.normal;

    const isOnSurface = this.surfaceType !== SurfaceType.Air && this.grounded;

    if (isOnSurface) {
      // Build rotation from forward projected onto surface plane + surface normal
      const up = new THREE.Vector3(this.surfaceNormal.x, this.surfaceNormal.y, this.surfaceNormal.z);

      // Project forward onto the surface plane (remove normal component)
      const rawFwd = new THREE.Vector3(this.forward.x, this.forward.y, this.forward.z);
      const dot = rawFwd.dot(up);
      const projected = rawFwd.clone().addScaledVector(up, -dot);

      if (projected.lengthSq() < 0.001) {
        // Forward nearly parallel to normal — use angle-based fallback
        projected.set(Math.sin(this.visualAngle), 0, Math.cos(this.visualAngle));
        projected.addScaledVector(up, -projected.dot(up)).normalize();
      } else {
        projected.normalize();
      }

      const right = new THREE.Vector3().crossVectors(projected, up).normalize();
      const mat = new THREE.Matrix4().makeBasis(right, up, projected.clone().negate());
      this.targetQuaternion.setFromRotationMatrix(mat);
    } else {
      // Air: use euler rotation (angle around Y)
      // Add PI to match the surface basis convention (model's -Z = forward)
      this.targetQuaternion.setFromEuler(new THREE.Euler(0, this.visualAngle + Math.PI, 0));
    }

    this.currentQuaternion.slerp(this.targetQuaternion, 1 - Math.exp(-10 * dt));
    this.mesh.quaternion.copy(this.currentQuaternion);
  }

  /** Apply body lean based on the angle between heading and velocity. */
  private updateDriftLean(): void {
    if (this.drifting) {
      const slideAngle = wrapAngle(this.angle - this.velocityAngle);
      this.bodyMesh.rotation.z = slideAngle * 0.4;
    } else {
      this.bodyMesh.rotation.z *= 0.85;
    }
  }

  private expireActiveEffect(): void {
    if (this.activeEffect) {
      this.activeEffect.onExpire(this);
    }
  }

  syncInvulnerabilityFromNet(isInvulnerable: boolean, timer: number): void {
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
    this.surfaceType = SurfaceType.Floor;
    this.surfaceNormal = { x: 0, y: 1, z: 0 };
    this.forward = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
    this.targetQuaternion.setFromEuler(new THREE.Euler(0, angle + Math.PI, 0));
    this.currentQuaternion.copy(this.targetQuaternion);
    this.visualPos.copy(this.position);
    this.visualAngle = this.angle;
    this.visualInitialized = false;
    this.mesh.visible = true;
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.currentQuaternion);
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
